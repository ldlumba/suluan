/**
 * Local-metadata citation formatting (owner-approved 2026-10-11 scope).
 *
 * Builds APA, BibTeX, and RIS citations only from SULUAN record metadata:
 * ordered author names, repository year (which serves as the publication
 * year), and title. Journal, volume, DOI, and other external publication
 * details are not supported yet and are never invented.
 */

export type CitationRecord = {
  title: string
  /** Ordered verbatim author names, e.g. "Ronquillo, Aldyne A.". */
  authors: string[]
  /** Repository year, e.g. "2026". */
  year: string | null
}

/**
 * Verified external publication metadata (automated exact-match Crossref
 * enrichment). When present, the published citation leads and the
 * repository citation is kept below it.
 */
export type CitationPublication = {
  doi: string
  venue: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  year: string | null
}

/** Fixed publisher for local repository citations. */
export const CITATION_PUBLISHER =
  'SULUAN Research Repository, University of the Assumption'

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

export type ParsedAuthor = {
  surname: string
  initials: string
  suffix: string | null
  /** True when the name could not be parsed and is used verbatim. */
  verbatim: boolean
}

/**
 * Parse one stored author name into APA parts. Stored names are usually
 * "Surname, Given ..." but intake is free text, so anything ambiguous is
 * returned verbatim rather than guessed.
 */
export function parseAuthorName(name: string): ParsedAuthor {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) return { surname: '', initials: '', suffix: null, verbatim: true }
  const comma = clean.indexOf(',')
  if (comma < 0) {
    const parts = clean.split(' ')
    if (parts.length === 1)
      return { surname: clean, initials: '', suffix: null, verbatim: true }
    // Unverified order: assume trailing surname, never silently reorder
    // multi-token names into initials without marking the guess.
    const surname = parts[parts.length - 1]
    return {
      surname,
      initials: toInitials(parts.slice(0, -1).join(' ')),
      suffix: null,
      verbatim: true,
    }
  }
  const surname = clean.slice(0, comma).trim()
  let given = clean.slice(comma + 1).trim()
  if (!surname || !given)
    return { surname: clean, initials: '', suffix: null, verbatim: true }
  let suffix: string | null = null
  const tokens = given.split(' ')
  const last = tokens[tokens.length - 1].replace(/\./g, '').toLowerCase()
  if (tokens.length > 1 && SUFFIXES.has(last)) {
    suffix = tokens.pop() ?? null
  }
  given = tokens.join(' ')
  return { surname, initials: toInitials(given), suffix, verbatim: false }
}

function toInitials(given: string): string {
  return given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((token) => {
      const letters = token.replace(/[^A-Za-z]/g, '')
      if (!letters) return ''
      // Single letters (with or without periods) stay single initials.
      return `${letters[0].toUpperCase()}.`
    })
    .filter(Boolean)
    .join(' ')
}

function apaName(author: ParsedAuthor): string {
  if (author.verbatim && !author.initials) return author.surname
  const base = author.initials
    ? `${author.surname}, ${author.initials}`
    : author.surname
  return author.suffix ? `${base}, ${author.suffix}` : base
}

function joinApa(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]}, & ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

/** APA 7th-style repository reference from local metadata. */
export function formatAPA(record: CitationRecord): string {
  const title = cleanTitle(record.title)
  const year = record.year?.trim() ? record.year.trim() : 'n.d.'
  const authors = record.authors
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => apaName(parseAuthorName(name)))
    .filter(Boolean)
  const authorPart = joinApa(authors)
  const head = authorPart ? `${authorPart} (${year}).` : `${title}. (${year}).`
  const tail = authorPart ? ` ${title}.` : ''
  return `${head}${tail} ${CITATION_PUBLISHER}.`
}

/** APA journal reference from verified external publication metadata. */
export function formatPublishedAPA(
  record: CitationRecord,
  publication: CitationPublication,
): string {
  const title = cleanTitle(record.title)
  const year = publication.year?.trim() || record.year?.trim() || 'n.d.'
  const authors = record.authors
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => apaName(parseAuthorName(name)))
    .filter(Boolean)
  const authorPart = joinApa(authors)
  const head = authorPart ? `${authorPart} (${year}).` : `${title}. (${year}).`
  const tail = authorPart ? ` ${title}.` : ''
  let venue = publication.venue?.trim() ? ` ${publication.venue.trim()}` : ''
  const volume = publication.volume?.trim() ?? ''
  const issue = publication.issue?.trim() ?? ''
  if (volume) venue += `, ${volume}${issue ? `(${issue})` : ''}`
  const pages = publication.pages?.trim()
  if (pages) venue += `, ${pages}`
  const doi = ` https://doi.org/${publication.doi.trim()}`
  return `${head}${tail}${venue ? `${venue}.` : ''}${doi}`
}

function bibtexKey(record: CitationRecord): string {
  const first = record.authors.map((name) => name.trim()).find(Boolean)
  const surname = first
    ? parseAuthorName(first)
        .surname.toLowerCase()
        .replace(/[^a-z]/g, '')
    : 'suluan'
  const year = record.year?.trim() || 'nodate'
  const word =
    cleanTitle(record.title)
      .split(' ')[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') || 'record'
  return `${surname || 'suluan'}${year}${word}`
}

function escapeBibTeX(value: string): string {
  return value.replace(/([\\&%$#_{}])/g, '\\$1')
}

/** BibTeX @misc entry from local metadata. */
export function formatBibTeX(record: CitationRecord): string {
  const authors = record.authors.map((name) => name.trim()).filter(Boolean)
  const lines = [
    `  title = {{${escapeBibTeX(cleanTitle(record.title))}}},`,
    `  howpublished = {${escapeBibTeX(CITATION_PUBLISHER)}}${record.year?.trim() ? ',' : ''}`,
  ]
  if (authors.length)
    lines.unshift(`  author = {${escapeBibTeX(authors.join(' and '))}},`)
  if (record.year?.trim()) lines.push(`  year = {${record.year.trim()}}`)
  return `@misc{${bibtexKey(record)},\n${lines.join('\n')}\n}`
}

/** BibTeX @article entry from verified external publication metadata. */
export function formatPublishedBibTeX(
  record: CitationRecord,
  publication: CitationPublication,
): string {
  const authors = record.authors.map((name) => name.trim()).filter(Boolean)
  const lines: string[] = [
    `  title = {{${escapeBibTeX(cleanTitle(record.title))}}},`,
  ]
  if (authors.length)
    lines.unshift(`  author = {${escapeBibTeX(authors.join(' and '))}},`)
  if (publication.venue?.trim())
    lines.push(`  journal = {${escapeBibTeX(publication.venue.trim())}},`)
  const year = publication.year?.trim() || record.year?.trim()
  if (year) lines.push(`  year = {${year}},`)
  if (publication.volume?.trim())
    lines.push(`  volume = {${escapeBibTeX(publication.volume.trim())}},`)
  if (publication.issue?.trim())
    lines.push(`  number = {${escapeBibTeX(publication.issue.trim())}},`)
  if (publication.pages?.trim())
    lines.push(`  pages = {${escapeBibTeX(publication.pages.trim())}},`)
  lines.push(`  doi = {${escapeBibTeX(publication.doi.trim())}}`)
  return `@article{${bibtexKey(record)},\n${lines.join('\n')}\n}`
}

/** RIS unpublished-work record from local metadata. */
export function formatRIS(record: CitationRecord): string {
  const lines = ['TY  - UNPB']
  for (const name of record.authors
    .map((name) => name.trim())
    .filter(Boolean)) {
    lines.push(`AU  - ${name}`)
  }
  lines.push(`TI  - ${cleanTitle(record.title)}`)
  if (record.year?.trim()) lines.push(`PY  - ${record.year.trim()}`)
  lines.push(`PB  - ${CITATION_PUBLISHER}`)
  lines.push('ER  - ')
  return lines.join('\n')
}

/** RIS journal record from verified external publication metadata. */
export function formatPublishedRIS(
  record: CitationRecord,
  publication: CitationPublication,
): string {
  const lines = ['TY  - JOUR']
  for (const name of record.authors
    .map((name) => name.trim())
    .filter(Boolean)) {
    lines.push(`AU  - ${name}`)
  }
  lines.push(`TI  - ${cleanTitle(record.title)}`)
  if (publication.venue?.trim()) lines.push(`JO  - ${publication.venue.trim()}`)
  const year = publication.year?.trim() || record.year?.trim()
  if (year) lines.push(`PY  - ${year}`)
  if (publication.volume?.trim())
    lines.push(`VL  - ${publication.volume.trim()}`)
  if (publication.issue?.trim()) lines.push(`IS  - ${publication.issue.trim()}`)
  if (publication.pages?.trim()) lines.push(`SP  - ${publication.pages.trim()}`)
  lines.push(`DO  - ${publication.doi.trim()}`)
  lines.push('ER  - ')
  return lines.join('\n')
}

export const CITATION_FORMATS = ['apa', 'bibtex', 'ris'] as const
export type CitationFormat = (typeof CITATION_FORMATS)[number]

export const CITATION_FILENAMES: Record<CitationFormat, string> = {
  apa: 'citation.txt',
  bibtex: 'citation.bib',
  ris: 'citation.ris',
}

export function formatCitation(
  record: CitationRecord,
  format: CitationFormat,
  publication?: CitationPublication | null,
): string {
  if (publication) {
    switch (format) {
      case 'bibtex':
        return formatPublishedBibTeX(record, publication)
      case 'ris':
        return formatPublishedRIS(record, publication)
      case 'apa':
      default:
        return formatPublishedAPA(record, publication)
    }
  }
  switch (format) {
    case 'bibtex':
      return formatBibTeX(record)
    case 'ris':
      return formatRIS(record)
    case 'apa':
    default:
      return formatAPA(record)
  }
}
