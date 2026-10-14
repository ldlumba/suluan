import { describe, expect, it } from 'vitest'
import {
  semanticDiscoveryMaxScore,
  semanticMaxScore,
} from '../src/semantic-policy'

describe('semantic score policy', () => {
  it('preserves the defensive default and accepts an explicit zero ceiling', () => {
    expect(semanticMaxScore()).toBe(0.7)
    expect(semanticMaxScore('0')).toBe(0)
    expect(semanticMaxScore('0.36')).toBe(0.36)
  })

  it.each(['', ' ', 'NaN', 'Infinity', '-0.1', '0.71', 'false'])(
    'rejects invalid configuration %j',
    (raw) => {
      expect(() => semanticMaxScore(raw)).toThrow()
    },
  )

  it('keeps discovery at or beyond the confident band', () => {
    expect(semanticDiscoveryMaxScore(undefined, 0.36)).toBe(0.36)
    expect(semanticDiscoveryMaxScore('0.40', 0.36)).toBe(0.4)
    expect(() => semanticDiscoveryMaxScore('0.35', 0.36)).toThrow()
  })
})
