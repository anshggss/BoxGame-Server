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
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Interaction constants
const port = process.env.PORT || 3000;
const RES_WIDTH = 1280;
const RES_HEIGHT = 720;
const tick = parseInt(process.env.TICK, 10) || 60;

// Game constants
let playerID = {};
let players = {};
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

// Target
const target = {
  x: Math.random() * 1280,
  y: getRandomBetween(40, 250),
  color: "green",
  width: 10,
  height: 10,
};

// Ensure target doesn't spawn inside a platform
function repositionTarget() {
  let validPosition = false;
  let attempts = 0;

  while (!validPosition && attempts < 100) {
    target.x = Math.random() * (RES_WIDTH - target.width);
    target.y = getRandomBetween(40, 250);
    validPosition = true;
    attempts++;

    // Check against all platforms
    for (const platform of world.platforms) {
      if (isColliding(target, platform)) {
        validPosition = false;
        break;
      }
    }
  }
}

// Rate limiter for inputs
const INPUT_RATE = 1000 / 120;
let lastInputTime = {};

io.on("connection", (socket) => {
  // Limit max players
  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit("serverFull", "Server is full. Try again later.");
    socket.disconnect();
    return;
  }

  playerID[socket.id] = true;
  players[socket.id] = {
    id: socket.id, // Store ID on the player object for client-side identification
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
  };

  let curPlayer = players[socket.id];
  lastInputTime[socket.id] = 0;

  // Handle Inputs with rate limiting
  socket.on("inputs", (input) => {
    if (!input) return;
    if (!players[socket.id]) return;

    const now = Date.now();
    if (now - lastInputTime[socket.id] < INPUT_RATE * 0.5) return;
    lastInputTime[socket.id] = now;

    // Reset horizontal velocity each frame
    curPlayer.velocityX = 0;

    if (input.left) {
      curPlayer.velocityX = -curPlayer.speed;
    }
    if (input.right) {
      curPlayer.velocityX = curPlayer.speed;
    }
    if (input.jump && curPlayer.isGrounded) {
      curPlayer.velocityY = jumpPower;
      curPlayer.isGrounded = false;
    }
  });

  console.log(
    `Connected: ${socket.id} | Players online: ${Object.keys(players).length}`,
  );

  socket.emit("init", world);

  // Handle name with sanitization
  socket.on("name", (pName) => {
    if (!players[socket.id]) return;
    if (typeof pName !== "string") return;

    // Sanitize name
    let sanitized = pName.trim().slice(0, 15);
    if (sanitized.length === 0) sanitized = "Player";

    players[socket.id].name = sanitized;
    console.log(`Player named: ${sanitized} (${socket.id})`);
  });

  // On disconnect
  socket.on("disconnect", () => {
    console.log(
      `Disconnected: ${socket.id} (${curPlayer.name}) | Players online: ${Object.keys(players).length - 1}`,
    );
    delete playerID[socket.id];
    delete players[socket.id];
    delete lastInputTime[socket.id];
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

  // Keep high score, reset current score
  if (player.score > player.highScore) {
    player.highScore = player.score;
  }
  player.score = 0;
  console.log(`Player died: ${player.name}`);
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

function checkTargetCollision(player) {
  if (isColliding(player, target)) {
    player.score += 1;
    if (player.score > player.highScore) {
      player.highScore = player.score;
    }
    repositionTarget();
    console.log(`${player.name} scored! Total: ${player.score}`);

    // Broadcast score event for effects
    io.emit("scoreEvent", {
      playerName: player.name,
      score: player.score,
      x: target.x,
      y: target.y,
    });
  }
}

function applyGravity(player) {
  player.velocityY += gravity;
  player.y += player.velocityY;
  player.x += player.velocityX;

  // Assume not grounded until proven otherwise
  let wasGrounded = player.isGrounded;
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

function updateGameState() {
  for (const playerId in players) {
    let player = players[playerId];

    applyGravity(player);

    // Use different variable name to avoid shadowing
    for (let i = 0; i < world.platforms.length; i++) {
      checkPlatformCollision(player, world.platforms[i]);
    }

    checkBounds(player);
    checkTargetCollision(player);
  }
}

// Game loop
setInterval(() => {
  updateGameState();
  io.emit("gameState", { target, players });
}, 1000 / tick);

// Server status endpoint
app.get("/status", (req, res) => {
  res.json({
    players: Object.keys(players).length,
    maxPlayers: MAX_PLAYERS,
    uptime: process.uptime(),
  });
});

server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Tick rate: ${tick}`);
});
