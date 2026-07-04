import createRoom from "./routes/createRoom";
import express from "express";
import cors from "cors";
import addToRoom from "./routes/addToRoom";

const app = express();
app.use(express.json());

// Allow the client origin to send credentials (cookies).
// Locally:   ALLOWED_ORIGIN=http://localhost:5500  (or omit for *)
// On Vercel: ALLOWED_ORIGIN=https://your-app.vercel.app
const allowedOrigin = [
  "https://gateway.boxgame.shadyggs.xyz",
  "http://localhost:4689",
  "https://boxgame.shadyggs.xyz",
];

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  }),
);

const port = process.env.PORT || 3000;
let roomMaps: { [id: string]: { [id: string]: string | number } } = {};

// Kubernetes health probe
app.get("/healthz", (_, res) => res.status(200).send("ok"));
// Adds a client to a given room
app.get("/add", addToRoom);
// Allocates a room to a client
app.get("/createRoom", createRoom);

app.listen(port, () => {
  console.log(`Listening on ${port}`);
  console.log(`CORS allowed origin: ${allowedOrigin}`);
});

export default roomMaps;
