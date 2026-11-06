import { describe, expect, it } from 'vitest'
import { findAbstractCandidate } from '../src/abstract-candidate'

describe('abstract candidate extraction', () => {
  it('finds text between an abstract heading and a following section', () => {
    const text =
      'Title\nABSTRACT\nThis study examines a community and reports the findings from a detailed survey.\nKeywords: community\nIntroduction\nText'
    expect(findAbstractCandidate(text)).toBe(
      'This study examines a community and reports the findings from a detailed survey.',
    )
  })
  it('does not guess without clear boundaries or accept overly short text', () => {
    expect(
      findAbstractCandidate(
        'Abstract\nThis is text without a following heading.',
      ),
    ).toBeNull()
    expect(findAbstractCandidate('Abstract\nShort.\nKeywords: test')).toBeNull()
    expect(
      findAbstractCandidate('No abstract heading\nIntroduction\nText'),
    ).toBeNull()
  })
})
