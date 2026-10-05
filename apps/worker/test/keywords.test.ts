import { describe, expect, it } from 'vitest'
import {
  MAX_KEYWORDS,
  normalizeKeyword,
  prepareSubmissionKeywords,
} from '../src/keywords'

describe('normalizeKeyword', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeKeyword('  Machine   LEARNING\n')).toBe('machine learning')
    expect(normalizeKeyword('Deep\t\tLearning')).toBe('deep learning')
  })

  it('does not merge synonyms', () => {
    expect(normalizeKeyword('AI')).not.toBe(
      normalizeKeyword('Artificial Intelligence'),
    )
  })
})

describe('prepareSubmissionKeywords', () => {
  it('accepts up to five ordered unique terms', () => {
    const result = prepareSubmissionKeywords(['Alpha', 'Beta', 'Gamma'])
    expect(result).toEqual({
      keywords: [
        { term: 'Alpha', normalized: 'alpha' },
        { term: 'Beta', normalized: 'beta' },
        { term: 'Gamma', normalized: 'gamma' },
      ],
    })
  })

  it('treats missing input as no keywords', () => {
    expect(prepareSubmissionKeywords(undefined)).toEqual({ keywords: [] })
  })

  it('collapses case-insensitive duplicates keeping the first', () => {
    const result = prepareSubmissionKeywords([
      'Machine Learning',
      'machine  learning',
      'MACHINE LEARNING',
      'Vision',
    ])
    expect(result).toEqual({
      keywords: [
        { term: 'Machine Learning', normalized: 'machine learning' },
        { term: 'Vision', normalized: 'vision' },
      ],
    })
  })

  it('skips blank parts instead of failing', () => {
    expect(prepareSubmissionKeywords(['  ', '', 'Real'])).toEqual({
      keywords: [{ term: 'Real', normalized: 'real' }],
    })
  })

  it('rejects more than five unique terms', () => {
    const result = prepareSubmissionKeywords(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(result).toEqual({ error: 'too_many_keywords' })
    expect(MAX_KEYWORDS).toBe(5)
  })

  it('rejects oversized raw parts and overlong terms', () => {
    expect(prepareSubmissionKeywords(['x'.repeat(201)])).toEqual({
      error: 'part_too_long',
    })
    expect(prepareSubmissionKeywords(['x'.repeat(101)])).toEqual({
      error: 'keyword_too_long',
    })
  })

  it('rejects non-string parts and part floods', () => {
    expect(prepareSubmissionKeywords([42])).toEqual({
      error: 'non_string_part',
    })
    expect(prepareSubmissionKeywords(new Array(11).fill('x'))).toEqual({
      error: 'too_many_parts',
    })
  })
})
