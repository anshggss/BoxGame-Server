// ============== CONFIG ==============
// GATEWAY_URL is injected by index.html as a <script> block so it works
// both locally and on Vercel without a bundler.
// Locally:  window.GATEWAY_URL = "http://localhost:3000"
// Vercel:   window.GATEWAY_URL = "https://gateway.boxgame.shadyggs.xyz"
const GATEWAY_URL = window.GATEWAY_URL;

// In production the game-server domain is server.boxgame.shadyggs.xyz.
// Nginx terminates TLS for wss://server.boxgame.shadyggs.xyz:<port> and
// forwards to the hostNetwork pod on the same port.
// In local dev the cookie will contain "localhost" so http:// is used.
const isLocalDev = GATEWAY_URL.startsWith("http://");
const WS_SCHEME = isLocalDev ? "http" : "wss";

// socket is created lazily after a room is assigned so we know which
// game-server host+port to connect to.
let socket = null;

let canvas = document.getElementById("gameCanvas");
let ctx = canvas.getContext("2d");

// DOM refs
const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const lobbyError = document.getElementById("lobbyError");
const hud = document.getElementById("hud");
const menuBtn = document.getElementById("menuBtn");
const roomBadge = document.getElementById("roomBadge");
const optionsModal = document.getElementById("optionsModal");
const newNameInput = document.getElementById("newNameInput");
const saveNameBtn = document.getElementById("saveNameBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const closeModalBtn = document.getElementById("closeModalBtn");
const roomInfo = document.getElementById("roomInfo");

let myID = null;
let world = null;
let players = {};
let target = null;
let currentRoomCode = null;
let pName = localStorage.getItem("name") || "";

// Pre-fill name from localStorage
if (pName) nameInput.value = pName;

// ============== LOBBY ACTIONS ==============
createRoomBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  if (!name) {
    showLobbyError("Please enter a name first.");
    return;
  }
  pName = name;
  localStorage.setItem("name", pName);
  setLobbyLoading(true);

  try {
    // Gateway picks the least-loaded game server, sets cookies
    // (hostIp, port, roomID) and returns.
    const res = await fetch(`${GATEWAY_URL}/createRoom`);
    if (!res.ok) {
      showLobbyError("No game servers available. Try again.");
      setLobbyLoading(false);
      return;
    }
    console.log(res);
    const { hostIp, port, roomID } = await res.json();
    console.log(`hostIp: ${hostIp}, port: ${port}`);
    if (!hostIp || !port || !roomID) {
      showLobbyError("Server response missing. Try again.");
      setLobbyLoading(false);
      return;
    }
    // Connect socket directly to the assigned game-server via TLS in prod
    connectSocket(`${WS_SCHEME}://${hostIp}:${port}`, () => {
      socket.emit("createRoom", pName, roomID, (ack) => {
        setLobbyLoading(false);
        if (ack && ack.success) {
          enterGame(ack.code);
        } else {
          showLobbyError("Failed to create room.");
        }
      });
    });
  } catch (e) {
    console.error(e);
    showLobbyError("Could not reach gateway.");
    setLobbyLoading(false);
  }
});

joinRoomBtn.addEventListener("click", async () => {
  const name = nameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) {
    showLobbyError("Please enter a name first.");
    return;
  }
  if (!code) {
    showLobbyError("Please enter a room code.");
    return;
  }
  pName = name;
  localStorage.setItem("name", pName);
  setLobbyLoading(true);

  try {
    // Ask gateway which server hosts this room
    const res = await fetch(`${GATEWAY_URL}/add?roomID=${code}`, {
      credentials: "include",
    });

    if (!res.ok) {
      showLobbyError("Room not found or no servers available.");
      setLobbyLoading(false);
      return;
    }

    const hostIp = getCookie("hostIp");
    const port = getCookie("port");

    if (!hostIp || !port) {
      showLobbyError("Could not locate room server.");
      setLobbyLoading(false);
      return;
    }

    connectSocket(`${WS_SCHEME}://${hostIp}:${port}`, () => {
      socket.emit("joinRoom", { name: pName, code }, (ack) => {
        setLobbyLoading(false);
        if (ack && ack.success) {
          enterGame(ack.code);
        } else {
          showLobbyError(ack ? ack.error : "Failed to join room.");
        }
      });
    });
  } catch (e) {
    console.error(e);
    showLobbyError("Could not reach gateway.");
    setLobbyLoading(false);
  }
});

roomCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoomBtn.click();
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createRoomBtn.click();
});

// Auto-uppercase room code input
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

function showLobbyError(msg) {
  lobbyError.textContent = msg;
  lobbyError.style.opacity = "1";
  setTimeout(() => {
    lobbyError.style.opacity = "0";
  }, 3000);
}

function setLobbyLoading(loading) {
  createRoomBtn.disabled = loading;
  joinRoomBtn.disabled = loading;
  createRoomBtn.textContent = loading ? "Connecting…" : "✦ Create Private Room";
}

// ============== SOCKET HELPERS ==============
// Creates (or re-creates) the socket pointing at a specific game-server.
function connectSocket(serverUrl, onConnected) {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  socket = io(serverUrl, {
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    transports: ["websocket"],
    autoConnect: true,
  });
  attachSocketListeners();
  socket.once("connect", onConnected);
}

// Reads a cookie by name (needed because gateway uses Set-Cookie)
function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function enterGame(code) {
  currentRoomCode = code;
  document.getElementById("nameScreen").style.display = "none";
  hud.style.display = "flex";
  roomBadge.textContent = `Room: ${code}`;
}

// ============== CONNECTION HANDLING ==============
// Listeners are registered via attachSocketListeners() each time a new
// socket is created, so they are defined as named functions here.
function attachSocketListeners() {
  socket.on("connect", () => {
    console.log("Connected:", socket.id);
    myID = socket.id;
  });

  socket.on("disconnect", (reason) => {
    console.log("Disconnected:", reason);
    players = {};
    target = null;
  });

  socket.on("connect_error", (err) => {
    console.error("Connection error:", err.message);
    showLobbyError("Cannot connect to server.");
  });

  // ============== WORLD INIT ==============
  socket.on("init", (newWorld) => {
    world = newWorld;
    resizeCanvas();
  });

  // ============== GAME STATE WITH DELTA MERGE ==============
  socket.on("gameState", (state) => {
    if (state.target) target = state.target;
    if (!state.players) return;

    if (state.full) {
      players = state.players;
    } else {
      for (const id in state.players) {
        if (state.players[id] === null) {
          delete players[id];
        } else {
          if (players[id]) {
            const incoming = state.players[id];
            const existing = players[id];
            existing.x = incoming.x;
            existing.y = incoming.y;
            existing.width = incoming.width;
            existing.height = incoming.height;
            existing.color = incoming.color;
            existing.velocityX = incoming.velocityX;
            existing.velocityY = incoming.velocityY;
            existing.name = incoming.name;
            existing.score = incoming.score;
            existing.id = incoming.id;
          } else {
            players[id] = state.players[id];
          }
        }
      }
    }

    if (socket.id && myID !== socket.id) myID = socket.id;
  });

  // ============== SERVER FULL ==============
  socket.on("serverFull", (msg) => {
    alert(msg);
  });

  // ============== SCORE EVENTS ==============
  socket.on("scoreEvent", (data) => {
    scorePopups.push({
      text: `${data.playerName} +1`,
      x: data.x,
      y: data.y,
      life: 1.0,
      decay: 0.02,
    });
    if (typeof spawnParticles === "function")
      spawnParticles(data.x, data.y, "#00ff88", 8);
  });
}

// scorePopups is declared here; listeners are registered in attachSocketListeners()
let scorePopups = [];

function updateScorePopups() {
  for (let i = scorePopups.length - 1; i >= 0; i--) {
    const popup = scorePopups[i];
    popup.y -= 1;
    popup.life -= popup.decay;
    if (popup.life <= 0) scorePopups.splice(i, 1);
  }
}

function drawScorePopups() {
  for (let i = 0; i < scorePopups.length; i++) {
    const popup = scorePopups[i];
    ctx.globalAlpha = popup.life;
    ctx.font = "bold 16px 'Segoe UI', Arial";
    ctx.fillStyle = "#00ffaa";
    ctx.textAlign = "center";
    ctx.fillText(popup.text, popup.x, popup.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}

// ============== OPTIONS MODAL ==============
menuBtn.addEventListener("click", () => {
  newNameInput.value = pName;
  roomInfo.innerHTML = `<span class="room-code-display">${currentRoomCode || "—"}</span><br><small>Share this code to invite friends</small>`;
  optionsModal.style.display = "flex";
});

closeModalBtn.addEventListener("click", () => {
  optionsModal.style.display = "none";
});

saveNameBtn.addEventListener("click", () => {
  const newName = newNameInput.value.trim();
  if (!newName) return;
  pName = newName;
  localStorage.setItem("name", pName);
  socket.emit("changeName", pName);
  saveNameBtn.textContent = "✓ Saved!";
  setTimeout(() => {
    saveNameBtn.textContent = "Save Name";
  }, 1500);
});

newNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveNameBtn.click();
});

copyCodeBtn.addEventListener("click", () => {
  if (!currentRoomCode) return;
  navigator.clipboard.writeText(currentRoomCode).then(() => {
    copyCodeBtn.textContent = "✓ Copied!";
    setTimeout(() => {
      copyCodeBtn.textContent = "Copy Room Code";
    }, 1500);
  });
});

// Close modal on backdrop click
optionsModal.addEventListener("click", (e) => {
  if (e.target === optionsModal) optionsModal.style.display = "none";
});
