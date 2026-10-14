/**
 * Packed-passage chunker for the King James Bible.
 *
 * Strategy: pack consecutive WHOLE verses into passages of up to MAX_CHARS.
 * A single verse is too short to embed well (median ~120 chars) and a whole
 * chapter mixes topics (median ~3,300 chars), so passages sit in between.
 * Chunks may cross chapter boundaries — chapter breaks are not always topic
 * breaks — but never cross a book, and a verse is never split, so every
 * chunk has an exact reference like "Genesis 1:1-5" or "Genesis 1:30-2:3".
 * A passage closes after a verse that ends a sentence when one is close
 * enough to the limit, since many KJV verses end mid-sentence at a comma.
 *
 * Usage:
 *   npm run bible:chunk
 *   npm run bible:chunk -- data/bible/chunks-smart.jsonl
 */

import * as fs from 'fs';
import { BOOKS, OLD_TESTAMENT_BOOKS } from '../../lib/books';
import { loadVerses, type Verse } from './parse';

const MAX_CHARS = 1200;
const OVERLAP_VERSES = 1; // each chunk repeats the last verse of the one before
const MIN_TAIL_CHARS = 300; // a shorter leftover at the end of a book joins the previous chunk
const MIN_CUT_CHARS = 600; // never close a passage early if that leaves it shorter than this
const DEFAULT_OUT = 'data/bible/chunks-smart.jsonl';

export type Chunk = {
  id: number;
  text: string;
  metadata: {
    reference: string;
    book: string;
    testament: 'Old' | 'New';
    chapter_start: number;
    verse_start: number;
    chapter_end: number;
    verse_end: number;
    verse_count: number;
  };
};

/** Split the flat verse list into one list per book, in canonical order */
function groupByBook(verses: Verse[]): Verse[][] {
  const books: Verse[][] = [];
  let previous: string | null = null;
  for (const v of verses) {
    if (v.book !== previous) {
      books.push([]);
      previous = v.book;
    }
    books[books.length - 1].push(v);
  }
  return books;
}

function textOf(verses: Verse[]): string {
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

/** Greedily pack one book's verses into passages of up to MAX_CHARS */
function packBook(verses: Verse[]): Verse[][] {
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

/** "Genesis 1:5", "Genesis 1:1-5", or "Genesis 1:30-2:3" when chapters are crossed */
function formatReference(book: string, first: Verse, last: Verse): string {
  const start = `${book} ${first.chapter}:${first.verse}`;
  if (first.chapter !== last.chapter) return `${start}-${last.chapter}:${last.verse}`;
  if (first.verse !== last.verse) return `${start}-${last.verse}`;
  return start;
}

export function chunkVerses(verses: Verse[]): Chunk[] {
  const books = groupByBook(verses);
  if (books.length !== BOOKS.length) {
    throw new Error(`Expected ${BOOKS.length} books but the parser found ${books.length}`);
  }

  const chunks: Chunk[] = [];
  books.forEach((bookVerses, bookIndex) => {
    const book = BOOKS[bookIndex];
    for (const passage of packBook(bookVerses)) {
      const first = passage[0];
      const last = passage[passage.length - 1];
      chunks.push({
        id: chunks.length,
        text: textOf(passage),
        metadata: {
          reference: formatReference(book, first, last),
          book,
          testament: bookIndex < OLD_TESTAMENT_BOOKS ? 'Old' : 'New',
          chapter_start: first.chapter,
          verse_start: first.verse,
          chapter_end: last.chapter,
          verse_end: last.verse,
          verse_count: passage.length,
        },
      });
    }
  });
  return chunks;
}

function main() {
  const outPath = process.argv[2] ?? DEFAULT_OUT;
  const chunks = chunkVerses(loadVerses());
  fs.writeFileSync(outPath, chunks.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`Wrote ${chunks.length} chunks to ${outPath}`);
}

main();
