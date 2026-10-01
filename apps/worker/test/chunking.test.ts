import { describe, expect, it } from 'vitest'
import { chunkText } from '../src/chunking'

describe('character chunking', () => {
  it('preserves source offsets, overlap and complete coverage including Unicode', () => {
    const text = 'a'.repeat(1999) + '😀' + 'b'.repeat(7000)
    const chunks = chunkText(text)
    let covered = 0
    for (const chunk of chunks) {
      expect(chunk.startOffset).toBeLessThanOrEqual(covered)
      expect(chunk.content).toBe(text.slice(chunk.startOffset, chunk.endOffset))
      expect(chunk.content.length).toBeLessThanOrEqual(2000)
      expect(() => encodeURIComponent(chunk.content)).not.toThrow()
      covered = chunk.endOffset
    }
    expect(covered).toBe(text.length)
    expect(chunks[1].startOffset).toBeLessThan(chunks[0].endOffset)
    expect(chunkText(text)).toEqual(chunks)
  })
  it('does not invent chunks for empty text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   ')).toEqual([])
    expect(chunkText('Short study.')[0].content).toBe('Short study.')
  })
})
