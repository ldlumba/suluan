/**
 * Comparison key for duplicate warnings. The submitted display title is never
 * changed. Unicode letters/numbers are retained; punctuation and spacing are
 * collapsed so case-only or punctuation-only variants compare equal.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}
