// This orchestrator talks with the server orchestrator to get the best server right now
import express from "express";
import assignServer from "./routes/assignServer";
import Heap from "./helper/heap";
import handleRegister from "./routes/handleRegister";
import { type Request, type Response } from "express";

const app = express();
const port = process.env.PORT || 4689;
app.use(express.json());

const connections = new Heap();

app.get("/assign", assignServer);
app.post("/register", handleRegister);
app.get("/health", (req: Request, res: Response) => {
  res.status(200).send("Yooo we're up");
});

app.listen({ port: Number(port), host: "0.0.0.0" }, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

export default connections;
