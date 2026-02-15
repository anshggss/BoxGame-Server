require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// Create server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  // Reduce socket.io overhead
  pingInterval: 10000,
  pingTimeout: 5000,
  perMessageDeflate: false, // Compression adds CPU cost
});

// Interaction constants
const port = parseInt(process.env.PORT) || 3000;
const RES_WIDTH = 1280;
const RES_HEIGHT = 720;
const tick = parseInt(process.env.TICK, 10) || 60;

// Game constants
let playerID = {};
let players = {};
let playerCount = 0; // Track count directly instead of Object.keys().length
const gravity = 0.5;
const jumpPower = -15;
const RESPAWN_X = 330;
const RESPAWN_Y = 300;
const PLAYER_SPEED = 3;
const MAX_PLAYERS = 20;

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

function getRandomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function getRandomColor() {
  return playerColors[Math.floor(Math.random() * playerColors.length)];
}

// World definition
const world = {
  canvasColor: "black",
  ground: {
    x: 320,
    y: 400,
    width: 640,
    height: 200,
  },
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
  ping: "World Received",
};

// ============== SPATIAL GRID FOR PLATFORM COLLISIONS ==============
// Pre-compute which platforms occupy which grid cells
const GRID_CELL_SIZE = 80;
const GRID_COLS = Math.ceil(RES_WIDTH / GRID_CELL_SIZE);
const GRID_ROWS = Math.ceil(RES_HEIGHT / GRID_CELL_SIZE);
const platformGrid = new Array(GRID_COLS * GRID_ROWS);

function buildPlatformGrid() {
  for (let i = 0; i < platformGrid.length; i++) {
    platformGrid[i] = [];
  }
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

function getNearbyPlatforms(player) {
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

  // Use a Set-like approach to avoid duplicates without allocating a Set
  const seen = getNearbyPlatforms._seen;
  seen.length = 0;
  const result = getNearbyPlatforms._result;
  result.length = 0;

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cell = platformGrid[row * GRID_COLS + col];
      for (let i = 0; i < cell.length; i++) {
        const plat = cell[i];
        if (seen.indexOf(plat) === -1) {
          seen.push(plat);
          result.push(plat);
        }
      }
    }
  }
  return result;
}
getNearbyPlatforms._seen = [];
getNearbyPlatforms._result = [];

// Target
const target = {
  x: Math.random() * 1280,
  y: getRandomBetween(40, 250),
  color: "green",
  width: 10,
  height: 10,
};

// ============== PRE-COMPUTE VALID TARGET SPAWN ZONES ==============
// Instead of random retry loop, pre-compute valid Y ranges for each X slice
function repositionTarget() {
  let validPosition = false;
  let attempts = 0;

  while (!validPosition && attempts < 50) {
    target.x = Math.random() * (RES_WIDTH - target.width);
    target.y = getRandomBetween(40, 250);
    validPosition = true;
    attempts++;

    // Only check platforms that could overlap (quick AABB)
    for (let i = 0; i < world.platforms.length; i++) {
      const platform = world.platforms[i];
      if (
        target.x + target.width > platform.x &&
        target.x < platform.x + platform.width &&
        target.y + target.height > platform.y &&
        target.y < platform.y + platform.height
      ) {
        validPosition = false;
        break;
      }
    }
  }
}

// ============== OPTIMIZED INPUT HANDLING ==============
io.on("connection", (socket) => {
  if (playerCount >= MAX_PLAYERS) {
    socket.emit("serverFull", "Server is full. Try again later.");
    socket.disconnect();
    return;
  }

  playerID[socket.id] = true;
  playerCount++;

  players[socket.id] = {
    id: socket.id,
    x: RESPAWN_X,
    y: RESPAWN_Y,
    width: 20,
    height: 20,
    color: getRandomColor(),
    velocityX: 0,
    velocityY: 0,
    speed: PLAYER_SPEED,
    isGrounded: false,
    name: "",
    score: 0,
    highScore: 0,
    // Store input state on the player — process in game loop
    inputLeft: false,
    inputRight: false,
    inputJump: false,
  };

  let curPlayer = players[socket.id];

  console.log(`Connected: ${socket.id} | Players online: ${playerCount}`);
  socket.emit("init", world);

  // ============== STORE INPUTS, DON'T PROCESS IMMEDIATELY ==============
  // This decouples input rate from physics rate
  socket.on("inputs", (input) => {
    if (!input || !curPlayer) return;

    // Just store the input state — game loop will read it
    curPlayer.inputLeft = !!input.left;
    curPlayer.inputRight = !!input.right;
    curPlayer.inputJump = !!input.jump;
  });

  socket.on("name", (pName) => {
    if (!players[socket.id]) return;
    if (typeof pName !== "string") return;

    let sanitized = pName.trim().slice(0, 15);
    if (sanitized.length === 0) sanitized = "Player";

    players[socket.id].name = sanitized;
    console.log(`Player named: ${sanitized} (${socket.id})`);
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      console.log(
        `Disconnected: ${socket.id} (${curPlayer.name}) | Players online: ${playerCount - 1}`,
      );
      delete playerID[socket.id];
      delete players[socket.id];
      playerCount--;
      curPlayer = null; // Prevent stale reference
    }
  });
});

// GAME LOGIC
function isColliding(a, b) {
  return (
    a.x + a.width > b.x &&
    a.x < b.x + b.width &&
    a.y + a.height > b.y &&
    a.y < b.y + b.height
  );
}

function respawnPlayer(player) {
  player.x = RESPAWN_X;
  player.y = RESPAWN_Y;
  player.velocityX = 0;
  player.velocityY = 0;
  player.isGrounded = false;

  if (player.score > player.highScore) {
    player.highScore = player.score;
  }
  player.score = 0;
  // Removed console.log from hot path
}

function checkBounds(player) {
  if (player.x + player.width > RES_WIDTH) {
    player.x = RES_WIDTH - player.width;
    player.velocityX = 0;
  }
  if (player.x < 0) {
    player.x = 0;
    player.velocityX = 0;
  }
  if (player.y > RES_HEIGHT) {
    respawnPlayer(player);
  }
  if (player.y < 0) {
    player.y = 0;
    player.velocityY = 0;
  }
}

// Track score events to batch-send
let pendingScoreEvents = [];

function checkTargetCollision(player) {
  if (isColliding(player, target)) {
    player.score += 1;
    if (player.score > player.highScore) {
      player.highScore = player.score;
    }

    // Queue score event instead of emitting immediately
    pendingScoreEvents.push({
      playerName: player.name,
      score: player.score,
      x: target.x,
      y: target.y,
    });

    repositionTarget();
  }
}

function applyGravity(player) {
  player.velocityY += gravity;
  player.y += player.velocityY;
  player.x += player.velocityX;

  player.isGrounded = false;

  // Ground collision
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

function checkPlatformCollision(player, platform) {
  if (!isColliding(player, platform)) {
    return;
  }

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

// ============== PROCESS INPUTS IN GAME LOOP (not in socket handler) ==============
function processInputs(player) {
  player.velocityX = 0;

  if (player.inputLeft) {
    player.velocityX = -player.speed;
  }
  if (player.inputRight) {
    player.velocityX = player.speed;
  }
  if (player.inputJump && player.isGrounded) {
    player.velocityY = jumpPower;
    player.isGrounded = false;
  }
}

function updateGameState() {
  for (const playerId in players) {
    const player = players[playerId];

    // Process stored inputs
    processInputs(player);

    // Physics
    applyGravity(player);

    // Platform collisions — use spatial grid
    const nearby = getNearbyPlatforms(player);
    for (let i = 0; i < nearby.length; i++) {
      checkPlatformCollision(player, nearby[i]);
    }

    checkBounds(player);
    checkTargetCollision(player);
  }
}

// ============== SEND ONLY WHAT THE CLIENT NEEDS ==============
// Build a slim payload instead of sending full player objects
function buildClientState() {
  const slimPlayers = {};
  for (const id in players) {
    const p = players[id];
    slimPlayers[id] = {
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
      // Don't send: speed, isGrounded, highScore, inputLeft, inputRight, inputJump
    };
  }
  return slimPlayers;
}

// ============== DELTA COMPRESSION: only send changed data ==============
let lastSentState = {};
let fullSyncCounter = 0;

function buildDeltaState() {
  const delta = {};
  let hasChanges = false;

  for (const id in players) {
    const p = players[id];
    const last = lastSentState[id];

    // New player or significant change
    if (
      !last ||
      Math.abs(p.x - last.x) > 0.5 ||
      Math.abs(p.y - last.y) > 0.5 ||
      p.score !== last.score ||
      p.name !== last.name
    ) {
      delta[id] = {
        id: p.id,
        x: Math.round(p.x * 10) / 10, // Reduce precision for smaller packets
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

  // Check for removed players
  for (const id in lastSentState) {
    if (!players[id]) {
      delta[id] = null; // Signal removal
      hasChanges = true;
    }
  }

  return hasChanges ? delta : null;
}

function cacheCurrentState() {
  lastSentState = {};
  for (const id in players) {
    const p = players[id];
    lastSentState[id] = {
      x: p.x,
      y: p.y,
      score: p.score,
      name: p.name,
    };
  }
}

// ============== GAME LOOP ==============
setInterval(() => {
  updateGameState();

  fullSyncCounter++;

  // Every 2 seconds, send full state to handle any desync
  if (fullSyncCounter >= tick * 2) {
    fullSyncCounter = 0;
    const fullState = buildClientState();
    io.emit("gameState", { target, players: fullState, full: true });
    cacheCurrentState();
  } else {
    // Otherwise send delta only
    const delta = buildDeltaState();
    if (delta) {
      io.emit("gameState", { target, players: delta });
      cacheCurrentState();
    }
    // If nothing changed, send nothing!
  }

  // Send queued score events
  if (pendingScoreEvents.length > 0) {
    for (let i = 0; i < pendingScoreEvents.length; i++) {
      io.emit("scoreEvent", pendingScoreEvents[i]);
    }
    pendingScoreEvents.length = 0;
  }
}, 1000 / tick);

// Server status endpoint
app.get("/status", (req, res) => {
  res.json({
    players: playerCount,
    maxPlayers: MAX_PLAYERS,
    uptime: process.uptime(),
  });
});

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Tick rate: ${tick}`);
});
