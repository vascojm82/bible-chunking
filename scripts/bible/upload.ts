/**
 * Uploader: embeds every chunk in a .jsonl file and upserts it into Qdrant.
 *
 * Each chunk becomes one point: id = chunk id, vector = embedding of the
 * chunk text, payload = the text plus all chunk metadata.
 * Upserting by id makes this safe to re-run — points are overwritten, not
 * duplicated.
 *
 * Usage:
 *   npm run bible:upload
 *   npm run bible:upload -- data/bible/chunks-smart.jsonl
 */

import * as fs from 'fs';
import { createEmbeddings, EMBEDDING_DIMENSIONS } from '../../lib/openai';
import { qdrant, BIBLE_COLLECTION } from '../../lib/qdrant';
import type { Chunk } from './chunk';

const DEFAULT_IN = 'data/bible/chunks-smart.jsonl';
const BATCH_SIZE = 100; // chunks per embedding request and per upsert
const FILTERABLE_FIELDS = ['book', 'testament'];

/** Create the collection if it is missing, and make sure its payload indexes exist */
async function ensureCollection() {
  const { exists } = await qdrant.collectionExists(BIBLE_COLLECTION);
  if (!exists) {
    await qdrant.createCollection(BIBLE_COLLECTION, {
      vectors: { size: EMBEDDING_DIMENSIONS, distance: 'Cosine' },
    });
    console.log(`Created collection "${BIBLE_COLLECTION}"`);
  }
  // Keyword indexes let searches filter by these fields ("only the New Testament")
  for (const field of FILTERABLE_FIELDS) {
    await qdrant.createPayloadIndex(BIBLE_COLLECTION, {
      field_name: field,
      field_schema: 'keyword',
    });
  }
}

async function main() {
  const path = process.argv[2] ?? DEFAULT_IN;
  if (!fs.existsSync(path)) {
    console.error(`No chunks file at ${path} — run "npm run bible:chunk" first`);
    process.exit(1);
  }

  const chunks: Chunk[] = fs
    .readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  await ensureCollection();

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    // Only the scripture text is embedded: the book filter in the search route
    // covers book context, and verse numbers in the vector were mistaken for
    // numbers in questions ("fourth day in Exodus" matched "Exodus 4:31").
    const vectors = await createEmbeddings(batch.map((c) => c.text));

    await qdrant.upsert(BIBLE_COLLECTION, {
      wait: true,
      points: batch.map((c, j) => ({
        id: c.id,
        vector: vectors[j],
        payload: { text: c.text, ...c.metadata },
      })),
    });
    console.log(`  uploaded ${Math.min(i + BATCH_SIZE, chunks.length)} / ${chunks.length}`);
  }

  const { count } = await qdrant.count(BIBLE_COLLECTION, { exact: true });
  console.log(`Done: "${BIBLE_COLLECTION}" now holds ${count} points`);
}

main();
