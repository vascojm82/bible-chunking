/**
 * Context writer: asks an LLM to situate each chunk within its chapter and
 * stores the answer as `metadata.context` (at most MAX_CONTEXT_CHARS).
 *
 * The context is embedded together with the chunk text (see upload.ts). It
 * helps in two ways: modern-English questions match a modern-English note
 * better than 17th-century KJV wording, and the note says what the chunk
 * alone does not, such as who is speaking and what led up to the passage
 * (including the end of the previous chapter, since chunks never cross one).
 *
 * Every answer is cached in data/bible/contexts.jsonl, keyed by a hash of the
 * chunk, so an interrupted run resumes where it stopped and re-running after
 * a chunker change only pays for the chunks that changed.
 *
 * Usage:
 *   npm run bible:context
 *   npm run bible:context -- <chunks.jsonl> <out.jsonl> [limit]
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { openai } from '../../lib/openai';
import { groupChapters, type Chapter, type Chunk } from './chunk';
import { loadVerses, type Verse } from './parse';

const DEFAULT_IN = 'data/bible/chunks-smart.jsonl';
const DEFAULT_OUT = 'data/bible/chunks-smart.jsonl'; // context is added to the chunks file in place
const CACHE_PATH = 'data/bible/contexts.jsonl';
const MODEL = 'gpt-4.1-mini';
const MAX_CONTEXT_CHARS = 300;
const LEAD_IN_VERSES = 3; // verses from the end of the previous chapter, for continuity
const CONCURRENCY = 12; // requests in flight at once

const INSTRUCTIONS = `You write short context notes for passages of the King James Bible. Each note is embedded alongside its passage to improve search.

Given a chapter and one passage from it, write one or two sentences in plain modern English, under 250 characters, that situate the passage: who is speaking or acting, what is happening, and how it connects to what comes before. Name the people and places involved.

Do not quote the passage, do not mention chapter or verse numbers, and do not interpret or preach. Reply with the note only.`;

type Usage = { prompt: number; cached: number; completion: number };

function numbered(verses: Verse[]): string {
  return verses.map((v) => `${v.verse} ${v.text}`).join('\n');
}

/** Chapter text first and the passage last, so requests for the same chapter share a cacheable prefix */
function promptFor(chunk: Chunk, chapter: Chapter, previous: Chapter | undefined): string {
  const leadIn = previous
    ? `End of ${previous.book} ${previous.chapter}, for continuity:\n${numbered(previous.verses.slice(-LEAD_IN_VERSES))}\n\n`
    : '';
  return `${leadIn}${chapter.book} ${chapter.chapter}:\n${numbered(chapter.verses)}\n\nPassage (${chunk.metadata.reference}):\n${chunk.text}`;
}

async function ask(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], usage: Usage) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.2,
    max_completion_tokens: 150,
  });
  usage.prompt += response.usage?.prompt_tokens ?? 0;
  usage.cached += response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  usage.completion += response.usage?.completion_tokens ?? 0;
  return (response.choices[0].message.content ?? '').replace(/\s+/g, ' ').trim();
}

/** Ask for the note; if it is too long, ask once to shorten it, then cut at a word boundary */
async function writeContext(prompt: string, usage: Usage): Promise<string> {
  const messages = [
    { role: 'system' as const, content: INSTRUCTIONS },
    { role: 'user' as const, content: prompt },
  ];
  let note = await ask(messages, usage);
  if (note.length > MAX_CONTEXT_CHARS) {
    note = await ask(
      [...messages, { role: 'assistant', content: note }, { role: 'user', content: 'Too long. Rewrite it in under 250 characters.' }],
      usage
    );
  }
  if (note.length > MAX_CONTEXT_CHARS) {
    note = note.slice(0, note.lastIndexOf(' ', MAX_CONTEXT_CHARS)).replace(/[,;:]$/, '') + '.';
  }
  return note;
}

function cacheKey(chunk: Chunk): string {
  return crypto.createHash('sha1').update(`${chunk.metadata.reference}\n${chunk.text}`).digest('hex');
}

function loadCache(): Map<string, string> {
  const cache = new Map<string, string>();
  if (!fs.existsSync(CACHE_PATH)) return cache;
  for (const line of fs.readFileSync(CACHE_PATH, 'utf-8').split('\n').filter(Boolean)) {
    const { key, context } = JSON.parse(line);
    cache.set(key, context);
  }
  return cache;
}

async function main() {
  const inPath = process.argv[2] ?? DEFAULT_IN;
  const outPath = process.argv[3] ?? DEFAULT_OUT;
  const limit = process.argv[4] ? Number(process.argv[4]) : Infinity;
  if (!fs.existsSync(inPath)) {
    console.error(`No chunks file at ${inPath} — run "npm run bible:chunk" first`);
    process.exit(1);
  }

  const chunks: Chunk[] = fs
    .readFileSync(inPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .slice(0, limit);

  // "Genesis 1" -> its chapter, plus the chapter before it in the same book
  const chapters = groupChapters(loadVerses());
  const byName = new Map(chapters.map((c, i) => [`${c.book} ${c.chapter}`, i]));

  const cache = loadCache();
  const todo = chunks.filter((c) => !cache.has(cacheKey(c)));
  console.log(`${chunks.length} chunks: ${chunks.length - todo.length} cached, ${todo.length} to write with ${MODEL}`);

  const usage: Usage = { prompt: 0, cached: 0, completion: 0 };
  const failures: string[] = [];
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < todo.length) {
      const chunk = todo[next++];
      const index = byName.get(`${chunk.metadata.book} ${chunk.metadata.chapter}`)!;
      const previous = chapters[index - 1]?.book === chunk.metadata.book ? chapters[index - 1] : undefined;
      try {
        const context = await writeContext(promptFor(chunk, chapters[index], previous), usage);
        const key = cacheKey(chunk);
        cache.set(key, context);
        fs.appendFileSync(CACHE_PATH, JSON.stringify({ key, reference: chunk.metadata.reference, context }) + '\n');
      } catch (err) {
        failures.push(`${chunk.metadata.reference}: ${(err as Error).message}`);
      }
      if (++done % 100 === 0) console.log(`  ${done} / ${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`Tokens: ${usage.prompt} prompt (${usage.cached} cached), ${usage.completion} completion`);
  if (failures.length > 0) {
    console.error(`${failures.length} chunks failed — re-run to retry just those:\n  ${failures.slice(0, 10).join('\n  ')}`);
    process.exit(1);
  }

  const withContext = chunks.map((c) => ({ ...c, metadata: { ...c.metadata, context: cache.get(cacheKey(c)) } }));
  fs.writeFileSync(outPath, withContext.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`Wrote ${withContext.length} chunks with context to ${outPath}`);
}

main();
