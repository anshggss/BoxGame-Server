import { type Request, type Response } from "express";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { Server } from "socket.io";

// Register the server to server-manager

// Create server
const app = express();
const server = http.createServer(app);
// This io creates a new socket connection for the clients to connect to
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 5000,
  perMessageDeflate: false,
});

// Interaction constants
const RES_WIDTH = 1280;
const RES_HEIGHT = 720;
const tick = 120;

// Game constants
const gravity = 0.5;
const jumpPower = -15;
const RESPAWN_X = 330;
const RESPAWN_Y = 300;
const PLAYER_SPEED = 3;
const MAX_PLAYERS_PER_ROOM = 20;

// Color palette for players
const playerColors = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#BB8FCE",
  "#85C1E9",
  "#F0B27A",
  "#82E0AA",
];

function getRandomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function getRandomColor() {
  return playerColors[Math.floor(Math.random() * playerColors.length)];
}

// World definition (shared, read-only)
const world = {
  canvasColor: "black",
  ground: { x: 320, y: 400, width: 640, height: 200 },
  platforms: [
    // first layer
    { x: 0, y: 340, width: 80, height: 20 },
    { x: 180, y: 340, width: 80, height: 20 },
    { x: 360, y: 340, width: 80, height: 20 },
    { x: 540, y: 340, width: 80, height: 20 },
    { x: 720, y: 340, width: 80, height: 20 },
    { x: 900, y: 340, width: 80, height: 20 },
    { x: 1080, y: 340, width: 80, height: 20 },
    { x: 1200, y: 340, width: 80, height: 20 },
    // second layer
    { x: 80, y: 280, width: 80, height: 20 },
    { x: 240, y: 280, width: 80, height: 20 },
    { x: 420, y: 280, width: 80, height: 20 },
    { x: 600, y: 280, width: 80, height: 20 },
    { x: 780, y: 280, width: 80, height: 20 },
    { x: 960, y: 280, width: 80, height: 20 },
    { x: 1140, y: 280, width: 80, height: 20 },
  ],
  platformColor: "red",
  resolution: { x: RES_WIDTH, y: RES_HEIGHT },
};

// ============== SPATIAL GRID (shared, read-only) ==============
const GRID_CELL_SIZE = 80;
const GRID_COLS = Math.ceil(RES_WIDTH / GRID_CELL_SIZE);
const GRID_ROWS = Math.ceil(RES_HEIGHT / GRID_CELL_SIZE);
const platformGrid = new Array(GRID_COLS * GRID_ROWS);

function buildPlatformGrid() {
  for (let i = 0; i < platformGrid.length; i++) platformGrid[i] = [];
  for (let i = 0; i < world.platforms.length; i++) {
    const p = world.platforms[i];
    const startCol = Math.max(0, Math.floor(p.x / GRID_CELL_SIZE));
    const endCol = Math.min(
      GRID_COLS - 1,
      Math.floor((p.x + p.width) / GRID_CELL_SIZE),
    );
    const startRow = Math.max(0, Math.floor(p.y / GRID_CELL_SIZE));
    const endRow = Math.min(
      GRID_ROWS - 1,
      Math.floor((p.y + p.height) / GRID_CELL_SIZE),
    );
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        platformGrid[row * GRID_COLS + col].push(world.platforms[i]);
      }
    }
  }
}
buildPlatformGrid();

const _seen: Platform[] = [];
const _result: Platform[] = [];

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Platform = Rectangle;

interface Target extends Rectangle {}

interface Player extends Rectangle {
  id: string;
  color: string;
  velocityX: number;
  velocityY: number;
  speed: number;
  isGrounded: boolean;
  name: string;
  score: number;
  highScore: number;
  inputLeft: boolean;
  inputRight: boolean;
  inputJump: boolean;
}
function getNearbyPlatforms(player: Player): Platform[] {
  const startCol = Math.max(0, Math.floor(player.x / GRID_CELL_SIZE));
  const endCol = Math.min(
    GRID_COLS - 1,
    Math.floor((player.x + player.width) / GRID_CELL_SIZE),
  );
  const startRow = Math.max(0, Math.floor(player.y / GRID_CELL_SIZE));
  const endRow = Math.min(
    GRID_ROWS - 1,
    Math.floor((player.y + player.height) / GRID_CELL_SIZE),
  );
  _seen.length = 0;
  _result.length = 0;
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = platformGrid[row * GRID_COLS + col];
      for (let i = 0; i < cell.length; i++) {
        const plat = cell[i];
        if (_seen.indexOf(plat) === -1) {
          _seen.push(plat);
          _result.push(plat);
        }
      }
    }
  }
  return _result;
}

// ============== ROOM MANAGEMENT ==============
// rooms[roomCode] = { players, target, lastSentState, fullSyncCounter, pendingScoreEvents }
//
// Rooms interface
interface Target {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScoreEvent {
  playerName: string;
  score: number;
  x: number;
  y: number;
}

interface CachedPlayerState {
  x: number;
  y: number;
  score: number;
  name: string;
}

interface Player {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  velocityX: number;
  velocityY: number;
  speed: number;
  isGrounded: boolean;
  name: string;
  score: number;
  highScore: number;
  inputLeft: boolean;
  inputRight: boolean;
  inputJump: boolean;
}

interface Room {
  players: Record<string, Player>;
  playerCount: number;
  target: Target;
  lastSentState: Record<string, CachedPlayerState>;
  fullSyncCounter: number;
  pendingScoreEvents: ScoreEvent[];
}
interface ClientPlayerState extends Rectangle {
  id: string;
  color: string;
  velocityX: number;
  velocityY: number;
  name: string;
  score: number;
}
type Rooms = Record<string, Room>;

const rooms: Rooms = {};

function deleteRoomIfEmpty(code: string) {
  const room = rooms[code];
  if (room && room.playerCount === 0) {
    delete rooms[code];
    console.log(`Room ${code} deleted (empty)`);
  }
}

// ============== GAME LOGIC ==============
function isColliding(a: Rectangle, b: Rectangle) {
  return (
    a.x + a.width > b.x &&
    a.x < b.x + b.width &&
    a.y + a.height > b.y &&
    a.y < b.y + b.height
  );
}

function respawnPlayer(player: Player) {
  player.x = RESPAWN_X;
  player.y = RESPAWN_Y;
  player.velocityX = 0;
  player.velocityY = 0;
  player.isGrounded = false;
  if (player.score > player.highScore) player.highScore = player.score;
  player.score = 0;
}

function checkBounds(player: Player) {
  if (player.x + player.width > RES_WIDTH) {
    player.x = RES_WIDTH - player.width;
    player.velocityX = 0;
  }
  if (player.x < 0) {
    player.x = 0;
    player.velocityX = 0;
  }
  if (player.y > RES_HEIGHT) respawnPlayer(player);
  if (player.y < 0) {
    player.y = 0;
    player.velocityY = 0;
  }
}

function repositionTarget(target: Target) {
  let valid = false,
    attempts = 0;
  while (!valid && attempts < 50) {
    target.x = Math.random() * (RES_WIDTH - target.width);
    target.y = getRandomBetween(40, 250);
    valid = true;
    attempts++;
    for (let i = 0; i < world.platforms.length; i++) {
      const p = world.platforms[i];
      if (
        target.x + target.width > p.x &&
        target.x < p.x + p.width &&
        target.y + target.height > p.y &&
        target.y < p.y + p.height
      ) {
        valid = false;
        break;
      }
    }
  }
}

function checkTargetCollision(player: Player, room: Room) {
  if (isColliding(player, room.target)) {
    player.score++;
    if (player.score > player.highScore) player.highScore = player.score;
    room.pendingScoreEvents.push({
      playerName: player.name,
      score: player.score,
      x: room.target.x,
      y: room.target.y,
    });
    repositionTarget(room.target);
  }
}

function applyGravity(player: Player) {
  player.velocityY += gravity;
  player.y += player.velocityY;
  player.x += player.velocityX;
  player.isGrounded = false;
  if (isColliding(player, world.ground)) {
    if (
      player.y + player.height > world.ground.y &&
      player.y < world.ground.y
    ) {
      player.velocityY = 0;
      player.y = world.ground.y - player.height;
      player.isGrounded = true;
    }
  }
}

function checkPlatformCollision(player: Player, platform: Rectangle) {
  if (!isColliding(player, platform)) return;
  const overlapLeft = player.x + player.width - platform.x;
  const overlapRight = platform.x + platform.width - player.x;
  const overlapTop = player.y + player.height - platform.y;
  const overlapBottom = platform.y + platform.height - player.y;
  const minOverlap = Math.min(
    overlapLeft,
    overlapRight,
    overlapTop,
    overlapBottom,
  );
  if (minOverlap === overlapTop && player.velocityY >= 0) {
    player.y = platform.y - player.height;
    player.velocityY = 0;
    player.isGrounded = true;
  } else if (minOverlap === overlapBottom && player.velocityY < 0) {
    player.y = platform.y + platform.height;
    player.velocityY = 0;
  } else if (minOverlap === overlapLeft) {
    player.x = platform.x - player.width;
    player.velocityX = 0;
  } else if (minOverlap === overlapRight) {
    player.x = platform.x + platform.width;
    player.velocityX = 0;
  }
}

function processInputs(player: Player) {
  player.velocityX = 0;
  if (player.inputLeft) player.velocityX = -player.speed;
  if (player.inputRight) player.velocityX = player.speed;
  if (player.inputJump && player.isGrounded) {
    player.velocityY = jumpPower;
    player.isGrounded = false;
  }
}

function updateRoom(room: Room) {
  for (const id in room.players) {
    const player = room.players[id];
    processInputs(player);
    applyGravity(player);
    const nearby = getNearbyPlatforms(player);
    for (let i = 0; i < nearby.length; i++)
      checkPlatformCollision(player, nearby[i]);
    checkBounds(player);
    checkTargetCollision(player, room);
  }
}

function buildClientState(room: Room) {
  const slim: Record<string, ClientPlayerState> = {};
  for (const id in room.players) {
    const p = room.players[id];
    slim[id] = {
      id: p.id,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      color: p.color,
      velocityX: p.velocityX,
      velocityY: p.velocityY,
      name: p.name,
      score: p.score,
    };
  }
  return slim;
}

function buildDeltaState(room: Room) {
  const delta: Record<string, ClientPlayerState | null> = {};
  let hasChanges = false;
  for (const id in room.players) {
    const p = room.players[id];
    const last = room.lastSentState[id];
    if (
      !last ||
      Math.abs(p.x - last.x) > 0.5 ||
      Math.abs(p.y - last.y) > 0.5 ||
      p.score !== last.score ||
      p.name !== last.name
    ) {
      delta[id] = {
        id: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        width: p.width,
        height: p.height,
        color: p.color,
        velocityX: Math.round(p.velocityX * 10) / 10,
        velocityY: Math.round(p.velocityY * 10) / 10,
        name: p.name,
        score: p.score,
      };
      hasChanges = true;
    }
  }
  for (const id in room.lastSentState) {
    if (!room.players[id]) {
      delta[id] = null;
      hasChanges = true;
    }
  }
  return hasChanges ? delta : null;
}

function cacheRoomState(room: Room) {
  room.lastSentState = {};
  for (const id in room.players) {
    const p = room.players[id];
    room.lastSentState[id] = { x: p.x, y: p.y, score: p.score, name: p.name };
  }
}

// ============== SOCKET CONNECTION ==============
io.on("connection", (socket) => {
  let currentRoomCode: string | null = null;

  console.log(`Connected: ${socket.id}`);

  // ---- CREATE ROOM ----
  socket.on("createRoom", (playerName, roomId, callback) => {
    if (currentRoomCode) {
      // Leave existing room first
      leaveCurrentRoom();
    }

    const code = roomId;
    currentRoomCode = code;
    socket.join(code);

    const sanitized = sanitizeName(playerName);

    // Initialize the room if it doesn't exist yet
    if (!rooms[code]) {
      const target: Target = { x: 0, y: 0, width: 30, height: 30 };
      repositionTarget(target);
      rooms[code] = {
        players: {},
        playerCount: 0,
        target,
        lastSentState: {},
        fullSyncCounter: 0,
        pendingScoreEvents: [],
      };
    }

    rooms[code].players[socket.id] = makePlayer(socket.id, sanitized);
    rooms[code].playerCount++;

    socket.emit("init", world);
    if (typeof callback === "function") callback({ success: true, code });
    console.log(`Room ${code} created by ${sanitized} (${socket.id})`);
  });

  // ---- JOIN ROOM ----
  socket.on("joinRoom", (data, callback) => {
    const code = (data.code || "").toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      if (typeof callback === "function")
        callback({ success: false, error: "Room not found." });
      return;
    }
    if (room.playerCount >= MAX_PLAYERS_PER_ROOM) {
      if (typeof callback === "function")
        callback({ success: false, error: "Room is full." });
      return;
    }

    if (currentRoomCode) leaveCurrentRoom();

    currentRoomCode = code;
    socket.join(code);

    const sanitized = sanitizeName(data.name);
    room.players[socket.id] = makePlayer(socket.id, sanitized);
    room.playerCount++;

    socket.emit("init", world);
    if (typeof callback === "function") callback({ success: true, code });
    console.log(`${sanitized} (${socket.id}) joined room ${code}`);
  });

  // ---- CHANGE NAME ----
  socket.on("changeName", (newName) => {
    if (!currentRoomCode || !rooms[currentRoomCode]) return;
    const player = rooms[currentRoomCode].players[socket.id];
    if (!player) return;
    player.name = sanitizeName(newName);
    console.log(
      `${socket.id} changed name to "${player.name}" in room ${currentRoomCode}`,
    );
  });

  // ---- INPUTS ----
  socket.on("inputs", (input) => {
    if (!currentRoomCode || !rooms[currentRoomCode]) return;
    const player = rooms[currentRoomCode].players[socket.id];
    if (!player || !input) return;
    player.inputLeft = !!input.left;
    player.inputRight = !!input.right;
    player.inputJump = !!input.jump;
  });

  // Legacy "name" event for compatibility
  socket.on("name", (pName) => {
    if (!currentRoomCode || !rooms[currentRoomCode]) return;
    const player = rooms[currentRoomCode].players[socket.id];
    if (player) player.name = sanitizeName(pName);
  });

  // ---- DISCONNECT ----
  socket.on("disconnect", () => {
    leaveCurrentRoom();
    console.log(`Disconnected: ${socket.id}`);
  });

  function leaveCurrentRoom() {
    if (!currentRoomCode || !rooms[currentRoomCode]) return;
    const room = rooms[currentRoomCode];
    if (room.players[socket.id]) {
      delete room.players[socket.id];
      room.playerCount--;
    }
    socket.leave(currentRoomCode);
    deleteRoomIfEmpty(currentRoomCode);
    currentRoomCode = null;
  }
});

// ============== GAME LOOP ==============
setInterval(() => {
  for (const code in rooms) {
    const room = rooms[code];
    if (room.playerCount === 0) continue;

    updateRoom(room);

    room.fullSyncCounter++;

    if (room.fullSyncCounter >= tick * 2) {
      room.fullSyncCounter = 0;
      const fullState = buildClientState(room);
      io.to(code).emit("gameState", {
        target: room.target,
        players: fullState,
        full: true,
      });
      cacheRoomState(room);
    } else {
      const delta = buildDeltaState(room);
      if (delta) {
        io.to(code).emit("gameState", { target: room.target, players: delta });
        cacheRoomState(room);
      }
    }

    if (room.pendingScoreEvents.length > 0) {
      for (let i = 0; i < room.pendingScoreEvents.length; i++) {
        io.to(code).emit("scoreEvent", room.pendingScoreEvents[i]);
      }
      room.pendingScoreEvents.length = 0;
    }
  }
}, 1000 / tick);

// ============== HELPERS ==============
function sanitizeName(name: string) {
  if (typeof name !== "string") return "Player";
  const s = name.trim().slice(0, 15);
  return s.length === 0 ? "Player" : s;
}

function makePlayer(id: string, name: string) {
  return {
    id,
    x: RESPAWN_X,
    y: RESPAWN_Y,
    width: 20,
    height: 20,
    color: getRandomColor(),
    velocityX: 0,
    velocityY: 0,
    speed: PLAYER_SPEED,
    isGrounded: false,
    name,
    score: 0,
    highScore: 0,
    inputLeft: false,
    inputRight: false,
    inputJump: false,
  };
}

// Status endpoint
app.get("/status", (req: Request, res: Response) => {
  res.sendStatus(200);
});

// ============== PORT SELECTION ==============
// In production, game-server pods must listen on a port within PORT_MIN–PORT_MAX
// so that the host Nginx stream proxy (which terminates TLS for
// wss://server.boxgame.shadyggs.xyz:<port>) can forward the traffic.
// In local dev, PORT_MIN / PORT_MAX are unset → falls back to listen(0).
const PORT_MIN = process.env.PORT_MIN ? parseInt(process.env.PORT_MIN) : 0;
const PORT_MAX = process.env.PORT_MAX ? parseInt(process.env.PORT_MAX) : 0;

function pickPort(): number {
  if (!PORT_MIN || !PORT_MAX) return 0;
  const publicPort =
    PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1));
  return publicPort; // bind on the internal, offset port
}
async function startOnPort(port: number, retries = 20): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", async (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && retries > 0) {
        server.removeAllListeners("error");
        const next = pickPort();
        console.warn(`Port ${port} in use, trying ${next}…`);
        await startOnPort(next, retries - 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
    server.listen(port, "127.0.0.1", resolve); // <-- bind loopback only
  });
}
startOnPort(pickPort())
  .then(async () => {
    const address = server.address() as AddressInfo;
    const publicPort = address.port;

    const serverInfo = {
      hostIp: process.env.HOST_IP,
      port: publicPort, // <-- report the public-facing port, clients/nginx use this
      connections: 0,
    };
    while (true) {
      try {
        console.log("SERVER_MANAGER_URL =", process.env.SERVER_MANAGER_URL);
        console.log("HOST_IP =", process.env.HOST_IP);
        console.log("Register payload =", serverInfo);
        const response = await fetch(
          `${process.env.SERVER_MANAGER_URL}/register`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(serverInfo),
          },
        );

        if (!response.ok) {
          throw new Error(`Registration failed: HTTP ${response.status}`);
        }

        console.log("Successfully registered with server-manager.");
        break;
      } catch (err) {
        console.error("Registration failed, retrying in 2 seconds...", err);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`Server running on port ${address.port}`);
    console.log(`Port range: ${PORT_MIN || "OS-assigned"}–${PORT_MAX || ""}`);
    console.log(`Tick rate: ${tick}`);
  })
  .catch((err) => {
    console.error("Unable to start HTTP server:", err);
    process.exit(1);
  });
