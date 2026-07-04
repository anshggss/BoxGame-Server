import { type Request, type Response } from "express";
import roomMaps from "../index.ts";

// Cross-site cookie options – must match createRoom.ts
const COOKIE_OPTS = {
  sameSite: "none" as const,
  secure: true,
  httpOnly: false,
};

// Public hostname clients use to reach game-server pods (same as createRoom)
const SERVER_HOST_DOMAIN = process.env.SERVER_HOST_DOMAIN || "localhost";

const addToRoom = async (req: Request, res: Response) => {
  // roomID comes from the query string: GET /add?roomID=ABCDE
  console.log(`roomID recvd:${req.query.roomID}`);
  const roomId = (req.query.roomID as string | undefined)?.toUpperCase();
  if (!roomId || roomMaps[roomId] == undefined) {
    res.status(400).send("Invalid room id");
    return;
  }

  // Use the same cookie names as createRoom so the client's getCookie() works.
  // Always send the public domain as hostIp so the browser can open wss://.
  res.json({
    hostIp: SERVER_HOST_DOMAIN,
    port: roomMaps[roomId].port,
    roomID: roomId,
  });
  return;
};

export default addToRoom;
