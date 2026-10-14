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
	'Song of Solomon': 'Song of (?:Solomon|Songs)',
};

// Ways to write the number of a numbered book: "1 John", "1st John", "First John".
const ORDINALS: Record<string, string> = {
	'1': '1|1st|first',
	'2': '2|2nd|second',
	'3': '3|3rd|third',
};
// Roman numerals ("I John", "II Kings") only count when capitalised, so the
// pronoun in "can i john..." is never read as a book number.
const ROMAN: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III' };

/** Every pattern that counts as a mention of this book */
function patternsFor(book: string): RegExp[] {
	const numbered = book.match(/^([123]) (.+)$/);
	if (numbered) {
		const [, n, name] = numbered;
		return [
			new RegExp(`(?<!\\w)(?:${ORDINALS[n]})\\s+${name}(?!\\w)`, 'gi'),
			new RegExp(`(?<!\\w)${ROMAN[n]}\\s+${name}(?!\\w)`, 'g'),
		];
	}
	const flags = EVERYDAY_WORDS.has(book) ? 'g' : 'gi';
	return [new RegExp(`(?<!\\w)${SPELLINGS[book] ?? book}(?!\\w)`, flags)];
}

// Longest first, so "1 John" is claimed before the plain "John" inside it.
const BOOK_PATTERNS = [...BOOKS]
	.sort((a, b) => b.length - a.length)
	.map((book) => ({ book, patterns: patternsFor(book) }));

/** Find the book names mentioned in a question, e.g. "the fourth day in Genesis" -> ["Genesis"] */
export function detectBooks(query: string): string[] {
	const found: string[] = [];
	let remaining = query;

	for (const { book, patterns } of BOOK_PATTERNS) {
		for (const pattern of patterns) {
			// Blank out each mention so a shorter name cannot match inside it
			const without = remaining.replace(pattern, ' ');
			if (without !== remaining && !found.includes(book)) found.push(book);
			remaining = without;
		}
	}
	return found.sort((a, b) => BOOKS.indexOf(a) - BOOKS.indexOf(b));
}
