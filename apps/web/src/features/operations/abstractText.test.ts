import { describe, expect, it } from 'vitest'
import { cleanAbstractWrapping, findSpacingWarnings } from './abstractText'

describe('local abstract review helpers', () => {
  it('joins single line wraps but retains paragraph breaks and words', () => {
    expect(
      cleanAbstractWrapping('A sentence\r\ncontinues.\r\n\r\nNext paragraph.'),
    ).toBe('A sentence continues.\n\nNext paragraph.')
  })
  it('flags possible joined words and offers only a complete local suggestion', () => {
    const warnings = findSpacingWarnings('Text accountingfirmsinPampanga ends.')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      word: 'accountingfirmsinPampanga',
      suggestion: 'accounting firms in Pampanga',
    })
    expect(
      findSpacingWarnings('Text accountingfirmsinPampanga ends.', [
        warnings[0].key,
      ]),
    ).toEqual([])
  })
  it('flags an unknown long word without inventing a correction', () => {
    expect(
      findSpacingWarnings('supercalifragilisticexpialidocious')[0].suggestion,
    ).toBeNull()
  })
})
