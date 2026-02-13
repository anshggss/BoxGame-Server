require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const port = process.env.PORT || 3000;
const RES_WIDTH = 1280;
const RES_HEIGHT = 720;
const tick = parseInt(process.env.TICK, 10) || 60;

// Serve static files

let playerID = {};
let players = {};
const gravity = 0.5;
const jumpPower = -10;

const world = {
  canvasColor: "purple",
  platform: {
    x: 320,
    y: 400,
    width: 640,
    height: 200,
    color: "black",
  },
  resolution: { x: RES_WIDTH, y: RES_HEIGHT },
  ping: "Message received",
};

// On initial connection, emit
io.on("connection", (socket) => {
  playerID[socket.id] = true;
  players[socket.id] = {
    x: 330,
    y: 300,
    width: 20,
    height: 20,
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`,
    velocityY: 0,
    speed: 2,
    isGrounded: false,
    name: "",
  };
  let curPlayer = players[socket.id];

  // Handle Inputs
  socket.on("inputs", (input) => {
    if (!input) return;

    if (input.left) {
      curPlayer.x -= 2;
    }
    if (input.right) {
      curPlayer.x += 2;
    }
    if (input.jump && curPlayer.isGrounded) {
      curPlayer.velocityY += jumpPower;
      curPlayer.isGrounded = false;
    }
  });

  console.log("Connected :", socket.id);

  socket.emit("init", world);
  socket.on("name", (pName) => {
    players[socket.id].name = pName;
    console.log(players[socket.id].name);
  });

  // On disconnection, remove playerID and player
  socket.on("disconnect", () => {
    console.log("Removed player :", socket.id);
    delete playerID[socket.id];
    delete players[socket.id];
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

function applyGravity(player) {
  player.velocityY += gravity;
  player.y += player.velocityY;

  if (isColliding(player, world.platform)) {
    // Colliding player's bottom with platform's top
    if (player.y < world.platform.y) {
      if (player.y + player.height > world.platform.y) {
        player.velocityY = 0;
        player.y = world.platform.y - player.height;
        player.isGrounded = true;
      }
    }
  }
}

function updateGameState() {
  for (const id in players) {
    let player = players[id];
    applyGravity(player);
  }
}

setInterval(() => {
  updateGameState();
  io.emit("config", players);
}, 1000 / tick);

// Server html file on this server
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
});
