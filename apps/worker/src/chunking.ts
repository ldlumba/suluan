/** Development default: character windows, not model tokens. Offsets use JS
 * UTF-16 code units and refer to the unchanged extracted text. Changing the
 * strategy requires a new version. No tokenizer/model dependency yet.
 */
export const CHUNKER_VERSION = 'chars-2000-overlap-200-v1'
const SIZE = 2000
const OVERLAP = 200

export function chunkText(text: string) {
  const chunks: {
    ordinal: number
    startOffset: number
    endOffset: number
    content: string
  }[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + SIZE, text.length)
    // Never cut a UTF-16 surrogate pair in half.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
    const content = text.slice(start, end)
    if (content.trim())
      chunks.push({
        ordinal: chunks.length,
        startOffset: start,
        endOffset: end,
        content,
      })
    if (end === text.length) break
    start = end - OVERLAP
    if (/[\uDC00-\uDFFF]/.test(text[start])) start++
  }
  return chunks
}
