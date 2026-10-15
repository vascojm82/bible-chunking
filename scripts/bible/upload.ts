/**
 * Uploader: embeds every chunk in a .jsonl file and upserts it into Qdrant.
 *
 * Each chunk becomes one point: id = chunk id, vector = embedding of the
 * chunk's context note followed by its text, payload = the text plus all
 * chunk metadata (context included). Upserting by id makes this safe to
 * re-run — points are overwritten, not duplicated.
 *
 * Usage:
 *   npm run bible:upload
 *   npm run bible:upload -- <chunks.jsonl> [collection]
 */

import * as fs from 'fs';
import { createEmbeddings, EMBEDDING_DIMENSIONS } from '../../lib/openai';
import { qdrant, BIBLE_COLLECTION } from '../../lib/qdrant';
import type { Chunk } from './chunk';

const DEFAULT_IN = 'data/bible/chunks-smart.jsonl';
const BATCH_SIZE = 100; // chunks per embedding request and per upsert
const FILTERABLE_FIELDS = ['book', 'testament'];

/** Create the collection if it is missing, and make sure its payload indexes exist */
async function ensureCollection(collection: string) {
  const { exists } = await qdrant.collectionExists(collection);
  if (!exists) {
    await qdrant.createCollection(collection, {
      vectors: { size: EMBEDDING_DIMENSIONS, distance: 'Cosine' },
    });
    console.log(`Created collection "${collection}"`);
  }
  // Keyword indexes let searches filter by these fields ("only the New Testament")
  for (const field of FILTERABLE_FIELDS) {
    await qdrant.createPayloadIndex(collection, {
      field_name: field,
      field_schema: 'keyword',
    });
  }
}

async function main() {
  const path = process.argv[2] ?? DEFAULT_IN;
  const collection = process.argv[3] ?? BIBLE_COLLECTION;
  if (!fs.existsSync(path)) {
    console.error(`No chunks file at ${path} — run "npm run bible:chunk" then "npm run bible:context" first`);
    process.exit(1);
  }

  const chunks: Chunk[] = fs
    .readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const missing = chunks.filter((c) => !c.metadata.context).length;
  if (missing > 0) {
    console.warn(`Warning: ${missing} chunks have no context and will be embedded as text only — run "npm run bible:context" first`);
  }

  await ensureCollection(collection);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    // The context note goes first: it names who and what in modern English,
    // which is how questions are asked. Verse numbers stay out of the vector
    // ("fourth day in Exodus" once matched "Exodus 4:31" because of them).
    const vectors = await createEmbeddings(
      batch.map((c) => (c.metadata.context ? `${c.metadata.context}\n\n${c.text}` : c.text))
    );

    await qdrant.upsert(collection, {
      wait: true,
      points: batch.map((c, j) => ({
        id: c.id,
        vector: vectors[j],
        payload: { text: c.text, ...c.metadata },
      })),
    });
    console.log(`  uploaded ${Math.min(i + BATCH_SIZE, chunks.length)} / ${chunks.length}`);
  }

  const { count } = await qdrant.count(collection, { exact: true });
  console.log(`Done: "${collection}" now holds ${count} points`);
}

main();
