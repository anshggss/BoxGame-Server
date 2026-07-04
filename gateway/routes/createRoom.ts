import { type Request, type Response } from "express";
import generateRoom from "../helper/generateRoom";
import roomMaps from "../index.ts";

// Cross-site cookie options required for Vercel (HTTPS) → VM (different origin).
// SameSite=None + Secure is mandatory for browsers to send cookies cross-site.
const COOKIE_OPTS = {
  sameSite: "none" as const,
  secure: true,
  httpOnly: false, // client JS must read these values
};

// The public hostname clients use to reach game-server pods.
// Set SERVER_HOST_DOMAIN=server.boxgame.shadyggs.xyz in production.
// The raw pod IP (hostNetwork) is unreachable from the browser.

async function fetchWithRetry(url: string, retries = 30) {
  while (retries--) {
    try {
      const res = await fetch(url);

      if (res.ok) {
        return res;
      }
    } catch (err) {
      console.error(err);
      console.log("Waiting for server manager...");
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("Server manager unavailable");
}
const SERVER_HOST_DOMAIN = process.env.SERVER_HOST_DOMAIN || "localhost";

const createRoom = async (_: Request, res: Response) => {
  let code: string;

  // Generate a unique room code
  do {
    code = generateRoom();
  } while (roomMaps[code] != undefined);

  const serverManager = process.env.SERVER_MANAGER_URL;

  try {
    // Get assigned a server
    const response = await fetchWithRetry(`${serverManager}/assign`);

    // Validate response
    if (
      response.headers.get("hostip") == null ||
      response.headers.get("port") == null
    ) {
      res.status(400).send("Couldn't get servers");
      return;
    }

    // Port mapping: server-manager returns the INTERNAL pod port (30000–31000).
    // The client must connect to the EXTERNAL nginx TLS port (20000–21000).
    // nginx listens on EXT_PORT and proxy_passes to EXT_PORT + 10000 (INT_PORT).
    // So: externalPort = internalPort - 10000.
    // See: nginx-gameserver-stream.conf and scripts/gen-stream-ports.sh.
    const INTERNAL_TO_EXTERNAL_OFFSET = 10000;
    const internalPort = Number(response.headers.get("port"));
    const externalPort = internalPort - INTERNAL_TO_EXTERNAL_OFFSET;

    const roomInfo = {
      // Always use the public domain — the raw pod IP (hostNetwork) is
      // not reachable from the browser.
      hostIp: SERVER_HOST_DOMAIN,
      port: externalPort, // external TLS port (20000–21000) — what clients dial
    };

    // Add roominfo in the map
    // TODO: Instead of using a map, use a key value store like Redis
    roomMaps[code] = roomInfo;

    // Set cookies – must be SameSite=None; Secure for cross-site delivery
    res.json({ hostIp: roomInfo.hostIp, port: roomInfo.port, roomID: code });
  } catch (e) {
    console.error(e);
    res.status(400).send("Bad request");
  }
};

export default createRoom;
