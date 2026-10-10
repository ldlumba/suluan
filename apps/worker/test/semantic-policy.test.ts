import { describe, expect, it } from 'vitest'
import { semanticMaxScore } from '../src/semantic-policy'

describe('semantic score policy', () => {
  it('preserves the defensive default and accepts an explicit zero ceiling', () => {
    expect(semanticMaxScore()).toBe(0.7)
    expect(semanticMaxScore('0')).toBe(0)
    expect(semanticMaxScore('0.36')).toBe(0.36)
  })

  it.each(['', ' ', 'NaN', 'Infinity', '-0.1', '0.71', 'false'])('rejects invalid configuration %j', (raw) => {
    expect(() => semanticMaxScore(raw)).toThrow()
  })
})
