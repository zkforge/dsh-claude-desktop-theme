/**
 * The card's footer sentence: the reference's book comparison.
 *
 * The numbers are the reference's own, recovered from its bundle: ten titles
 * with a token count each, and two message shapes. The rule is
 *
 * ```
 * eligible = books the total already exceeds          (none → the line is hidden)
 * book     = eligible[floor(random * eligible.length)] (drawn once per mount)
 * times    = floor(total / book.tokens)
 * times >= 2 → "You've used ~{times}× more tokens than {book}."
 * otherwise  → "You've used about as many tokens as {book}."
 * ```
 *
 * Only the sentence is copied; nothing is fetched and no book text is
 * involved. Titles and sentences are localized into Simplified Chinese.
 */

/** One comparable book: the title as printed, and the tokens it would take. */
export interface Book {
  readonly name: string;
  readonly tokens: number;
}

/** The reference's list, in its own order. */
export const BOOKS: readonly Book[] = Object.freeze([
  { name: '小王子', tokens: 22_000 },
  { name: '动物农场', tokens: 39_000 },
  { name: '了不起的盖茨比', tokens: 62_000 },
  { name: '哈利·波特与魔法石', tokens: 103_000 },
  { name: '霍比特人', tokens: 123_000 },
  { name: '傲慢与偏见', tokens: 156_000 },
  { name: '沙丘', tokens: 244_000 },
  { name: '白鲸', tokens: 268_000 },
  { name: '魔戒', tokens: 576_000 },
  { name: '战争与和平', tokens: 730_000 },
]);

/**
 * Build the footer sentence for one token total.
 *
 * @param totalTokens - all-time token total at the provider's scale.
 * @param random - one draw in `[0, 1)`; callers pass a value that is stable for
 *   the lifetime of a mount, so the sentence does not change between polls.
 * @returns the sentence, or null while no book is smaller than the total.
 */
export function bookNote(totalTokens: number, random: () => number): string | null {
  const eligible = BOOKS.filter(book => totalTokens >= book.tokens);
  if (eligible.length === 0) return null;
  const draw = Math.min(Math.max(random(), 0), 0.999_999);
  const book = eligible[Math.floor(draw * eligible.length)];
  if (book === undefined) return null;
  const times = Math.floor(totalTokens / book.tokens);
  if (times >= 2) return `已使用的 Token 量约相当于《${book.name}》的 ${times} 倍。`;
  return `已使用的 Token 量约相当于一本《${book.name}》。`;
}
