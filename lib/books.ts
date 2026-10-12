// The 66 books by short name, in canonical order. These are the exact values
// stored in each chunk's `book` metadata, so they are also what Qdrant filters on.
export const BOOKS = [
	'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
	'1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
	'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
	'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
	'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
	'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
	'2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
	'1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
	'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude',
	'Revelation',
];
export const OLD_TESTAMENT_BOOKS = 39;

// Names that are also everyday words ("a job", "mark my words"): these only
// count as a book when capitalised. Every other name matches in any case.
const EVERYDAY_WORDS = new Set(['Job', 'Mark', 'Acts', 'Numbers', 'Judges']);

// Common ways people write a name that differ from the stored one.
const SPELLINGS: Record<string, string> = {
	Psalms: 'Psalms?',
	Revelation: 'Revelations?',
};

// Longest first, so "1 John" is claimed before the plain "John" inside it.
const LONGEST_FIRST = [...BOOKS].sort((a, b) => b.length - a.length);

/** Find the book names mentioned in a question, e.g. "the fourth day in Genesis" -> ["Genesis"] */
export function detectBooks(query: string): string[] {
	const found: string[] = [];
	let remaining = query;

	for (const book of LONGEST_FIRST) {
		const flags = EVERYDAY_WORDS.has(book) ? 'g' : 'gi';
		const pattern = new RegExp(`(?<!\\w)${SPELLINGS[book] ?? book}(?!\\w)`, flags);
		if (pattern.test(remaining)) {
			found.push(book);
			remaining = remaining.replace(pattern, ' ');
		}
	}
	return found.sort((a, b) => BOOKS.indexOf(a) - BOOKS.indexOf(b));
}
