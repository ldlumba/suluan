import { describe, expect, it } from 'vitest'
import { normalizeTitle } from '../src/titles'

describe('title duplicate normalization', () => {
  it('ignores case, punctuation, compatibility forms and repeated spaces', () => {
    expect(normalizeTitle('  FARMERS’ Health: A Study  ')).toBe(
      'farmers health a study',
    )
    expect(normalizeTitle('Farmers Health — A   Study')).toBe(
      'farmers health a study',
    )
    expect(normalizeTitle('ＡＢＣ １２３')).toBe('abc 123')
  })

  it('does not erase meaningful letters or numbers', () => {
    expect(normalizeTitle('COVID-19 in Pampanga')).toBe('covid 19 in pampanga')
  })

  it('produces no comparison key for punctuation-only input', () => {
    expect(normalizeTitle('— · !!!')).toBe('')
  })
})
