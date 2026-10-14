import { describe, expect, it } from 'vitest'
import {
  formatAPA,
  formatBibTeX,
  formatPublishedAPA,
  formatPublishedBibTeX,
  formatPublishedRIS,
  formatRIS,
  parseAuthorName,
} from './formatCitation'

describe('citation formatting from local metadata', () => {
  it('parses stored surname-first names into APA initials', () => {
    expect(parseAuthorName('Ronquillo, Aldyne A.')).toMatchObject({
      surname: 'Ronquillo',
      initials: 'A. A.',
      verbatim: false,
    })
    expect(parseAuthorName('Salas, John Mark I.')).toMatchObject({
      surname: 'Salas',
      initials: 'J. M. I.',
    })
    expect(parseAuthorName('Dela Cruz, Juan Jr.')).toMatchObject({
      surname: 'Dela Cruz',
      initials: 'J.',
      suffix: 'Jr.',
    })
  })

  it('never guesses at unparseable names', () => {
    expect(parseAuthorName('Anonymous').verbatim).toBe(true)
    expect(parseAuthorName('').verbatim).toBe(true)
    expect(parseAuthorName('Solo').surname).toBe('Solo')
  })

  it('formats multi-author APA with the repository as publisher', () => {
    expect(
      formatAPA({
        title: 'AidTrack: A Relief System',
        authors: [
          'Ronquillo, Aldyne A.',
          'Salas, John Mark I.',
          'Simon, Sean Austine M.',
        ],
        year: '2026',
      }),
    ).toBe(
      'Ronquillo, A. A., Salas, J. M. I., & Simon, S. A. M. (2026). AidTrack: A Relief System. SULUAN Research Repository, University of the Assumption.',
    )
  })

  it('degrades without inventing authors or dates', () => {
    expect(
      formatAPA({ title: 'Untitled Study', authors: [], year: null }),
    ).toContain('(n.d.)')
    expect(
      formatAPA({ title: 'Untitled Study', authors: [], year: null }),
    ).not.toContain('Anonymous')
    expect(
      formatAPA({ title: 'Study', authors: ['Solo'], year: '2026' }),
    ).toContain('Solo (2026).')
  })

  it('emits BibTeX and RIS without external fields', () => {
    const bib = formatBibTeX({
      title: 'Soil & Health 100%',
      authors: ['Miclat, J. H. S.'],
      year: '2026',
    })
    expect(bib).toContain('@misc{miclat2026soil,')
    expect(bib).not.toMatch(/doi|journal|volume/i)
    expect(bib).toContain('Soil \\& Health 100\\%')
    const ris = formatRIS({
      title: 'Soil Study',
      authors: ['Miclat, J. H. S.', 'Suba, J. M.'],
      year: '2026',
    })
    expect(ris).toContain('TY  - UNPB')
    expect(ris).toContain('AU  - Miclat, J. H. S.')
    expect(ris).toContain('PY  - 2026')
    expect(ris.endsWith('ER  - ')).toBe(true)
  })

  it('leads with the verified published version when present', () => {
    const record = {
      title: 'SoilScope: Integrating AI into Soil Diagnostics',
      authors: ['Miclat, Juan H. S.', 'Suba, Jose M.'],
      year: '2026',
    }
    const publication = {
      doi: '10.36948/ijfmr.2026.v08i03.79352',
      venue: 'International Journal for Multidisciplinary Research',
      volume: '8',
      issue: '3',
      pages: '1-10',
      year: '2026',
    }
    expect(formatPublishedAPA(record, publication)).toBe(
      'Miclat, J. H. S., & Suba, J. M. (2026). SoilScope: Integrating AI into Soil Diagnostics. International Journal for Multidisciplinary Research, 8(3), 1-10. https://doi.org/10.36948/ijfmr.2026.v08i03.79352',
    )
    const bib = formatPublishedBibTeX(record, publication)
    expect(bib).toContain('@article{miclat2026soilscope,')
    expect(bib).toContain('journal = {International Journal')
    expect(bib).toContain('doi = {10.36948/ijfmr.2026.v08i03.79352}')
    const ris = formatPublishedRIS(record, publication)
    expect(ris).toContain('TY  - JOUR')
    expect(ris).toContain('DO  - 10.36948/ijfmr.2026.v08i03.79352')
  })
})
