import "./lib/env.js";
import express from "express";
import indexRouter from "./routes/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(indexRouter);

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body must be valid JSON" });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
