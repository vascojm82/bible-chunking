/**
 * Packed-passage chunker for the King James Bible.
 *
 * Strategy: pack consecutive WHOLE verses into passages of up to MAX_CHARS.
 * A single verse is too short to embed well (median ~120 chars) and a whole
 * chapter mixes topics (median ~3,300 chars), so passages sit in between.
 * Chunks stay inside one chapter and a verse is never split, so every chunk
 * has an exact single-chapter reference like "Exodus 32:5-11". Continuity
 * across chapter breaks comes from each chunk's LLM-written `context` (see
 * context.ts), not from the chunk text.
 * A passage closes after a verse that ends a sentence when one is close
 * enough to the limit, since many KJV verses end mid-sentence at a comma.
 *
 * Usage:
 *   npm run bible:chunk
 *   npm run bible:chunk -- data/bible/chunks-smart.jsonl
 *   Once you have decided your chunk size is right run,
 *   npm run bible:context, this will add context to metadata in data/bible/chunks-smart.jsonl
 */

import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { BOOKS, OLD_TESTAMENT_BOOKS } from '../../lib/books';
import { loadVerses, type Verse } from './parse';

const MAX_CHARS = 1200;
const OVERLAP_VERSES = 1; // each chunk repeats the last verse of the one before
const MIN_TAIL_CHARS = 300; // a shorter leftover at the end of a chapter joins the previous chunk
const MIN_CUT_CHARS = 600; // never close a passage early if that leaves it shorter than this
const DEFAULT_OUT = 'data/bible/chunks-smart.jsonl';

export type Chunk = {
  id: number;
  text: string;
  metadata: {
    reference: string;
    book: string;
    testament: 'Old' | 'New';
    chapter: number;
    verse_start: number;
    verse_end: number;
    verse_count: number;
    context?: string; // added by context.ts: where this passage sits in the story
  };
};

export type Chapter = {
  book: string; // short name, e.g. "Genesis"
  testament: 'Old' | 'New';
  chapter: number;
  verses: Verse[];
};

/** Split the flat verse list into chapters, in canonical order, with short book names */
export function groupChapters(verses: Verse[]): Chapter[] {
  const chapters: Chapter[] = [];
  let bookIndex = -1;
  let previousBook: string | null = null;

  for (const v of verses) {
    if (v.book !== previousBook) {
      bookIndex++;
      previousBook = v.book;
    }
    const last = chapters[chapters.length - 1];
    if (last && last.book === BOOKS[bookIndex] && last.chapter === v.chapter) {
      last.verses.push(v);
    } else {
      chapters.push({
        book: BOOKS[bookIndex],
        testament: bookIndex < OLD_TESTAMENT_BOOKS ? 'Old' : 'New',
        chapter: v.chapter,
        verses: [v],
      });
    }
  }

  if (bookIndex + 1 !== BOOKS.length) {
    throw new Error(`Expected ${BOOKS.length} books but the parser found ${bookIndex + 1}`);
  }
  return chapters;
}

export function textOf(verses: Verse[]): string {
  return verses.map((v) => v.text).join(' ');
}

const SENTENCE_END = /[.!?][’'"”)]*$/;
const CLAUSE_END = /[:;][’'"”)]*$/;

/**
 * Where to close a full passage: after the last verse that ends a sentence,
 * else after the last that ends a clause (":" or ";"), else after the last
 * verse. Only verses in the final `fresh` stretch qualify, so the passage
 * always gains at least one new verse, and never before MIN_CUT_CHARS.
 */
function cutIndex(current: Verse[], fresh: number): number {
  const candidates: number[] = [];
  for (let cut = current.length; cut > current.length - fresh; cut--) {
    if (textOf(current.slice(0, cut)).length < MIN_CUT_CHARS) break;
    candidates.push(cut);
  }
  const endsWith = (re: RegExp) => candidates.find((cut) => re.test(current[cut - 1].text));
  return endsWith(SENTENCE_END) ?? endsWith(CLAUSE_END) ?? current.length;
}

/** Greedily pack one chapter's verses into passages of up to MAX_CHARS */
function packChapter(verses: Verse[]): Verse[][] {
  const passages: Verse[][] = [];
  let current: Verse[] = [];
  let fresh = 0; // verses in `current` that are not overlap from the previous passage

  for (const v of verses) {
    while (fresh > 0 && textOf(current).length + 1 + v.text.length > MAX_CHARS) {
      const cut = cutIndex(current, fresh);
      passages.push(current.slice(0, cut));
      // Verses after the cut move on to the next passage, behind the overlap
      const carried = current.slice(cut);
      current = [...current.slice(Math.max(0, cut - OVERLAP_VERSES), cut), ...carried];
      fresh = carried.length;
    }
    current.push(v);
    fresh++;
  }

  if (fresh > 0) {
    const tail = current.slice(-fresh);
    if (passages.length > 0 && textOf(tail).length < MIN_TAIL_CHARS) {
      passages[passages.length - 1].push(...tail);
    } else {
      passages.push(current);
    }
  }
  return passages;
}

/** "Genesis 1:5" or "Genesis 1:1-5" */
function formatReference(chapter: Chapter, first: Verse, last: Verse): string {
  const start = `${chapter.book} ${chapter.chapter}:${first.verse}`;
  return first.verse === last.verse ? start : `${start}-${last.verse}`;
}

export function chunkVerses(verses: Verse[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const chapter of groupChapters(verses)) {
    for (const passage of packChapter(chapter.verses)) {
      const first = passage[0];
      const last = passage[passage.length - 1];
      chunks.push({
        id: chunks.length,
        text: textOf(passage),
        metadata: {
          reference: formatReference(chapter, first, last),
          book: chapter.book,
          testament: chapter.testament,
          chapter: chapter.chapter,
          verse_start: first.verse,
          verse_end: last.verse,
          verse_count: passage.length,
        },
      });
    }
  }
  return chunks;
}

function main() {
  const outPath = process.argv[2] ?? DEFAULT_OUT;
  const chunks = chunkVerses(loadVerses());
  fs.writeFileSync(outPath, chunks.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`Wrote ${chunks.length} chunks to ${outPath}`);
}

// Only run when executed directly, so other scripts can import the helpers above
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
