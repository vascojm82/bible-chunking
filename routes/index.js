import { Router } from "express";
import { detectBooks } from "../lib/books.ts";
import { createEmbedding } from "../lib/openai.ts";
import { qdrant, BIBLE_COLLECTION } from "../lib/qdrant.ts";

const router = Router();
const DEFAULT_K = 5;

router.post("/search", async (req, res) => {
  const { query, k = DEFAULT_K } = req.body ?? {};

  if (typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "`query` must be a non-empty string" });
  }
  if (!Number.isInteger(k) || k < 1) {
    return res.status(400).json({ error: "`k` must be a positive integer" });
  }

  // If the question names one or more books, only search inside those books.
  const books = detectBooks(query);
  const filter =
    books.length > 0 ? { must: [{ key: "book", match: { any: books } }] } : undefined;

  // Embed the query with the same model the chunks were embedded with, then
  // ask Qdrant for the k nearest chunks.
  const vector = await createEmbedding(query);
  const { points } = await qdrant.query(BIBLE_COLLECTION, {
    query: vector,
    limit: k,
    with_payload: true,
    filter,
  });

  const results = points.map((point) => ({
    id: point.id,
    score: point.score,
    ...point.payload,
  }));

  res.json({ query, k, books, results });
});

export default router;
