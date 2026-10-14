import { sql } from 'drizzle-orm'
import type { Db } from './db'

/**
 * Automated external-publication enrichment (owner-approved 2026-10-11).
 *
 * Fully automatic with no manager action: the scheduled sweep queries
 * Crossref for accepted records, auto-attaches metadata ONLY on an exact
 * normalized-title match plus author and year agreement, and otherwise
 * records the check and keeps the local citation. Guesses are never stored.
 */

export const DOI_SWEEP_BATCH = 5
const CROSSREF_URL = 'https://api.crossref.org/works'
const DOI_SOURCE = 'crossref'

export type DoiCandidate = {
  doi: string
  titles: string[]
  surnames: string[]
  year: number | null
  venue: string | null
  volume: string | null
  issue: string | null
  pages: string | null
}

/** Lowercase alphanumeric tokens; punctuation and spacing collapse away. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Surname per ordered name: before the first comma, else the last token. */
export function authorSurnames(names: string[]): string[] {
  return names
    .map((name) => name.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((name) => {
      const comma = name.indexOf(',')
      const raw =
        comma >= 0 ? name.slice(0, comma) : (name.split(' ').pop() ?? '')
      return raw
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ')
    })
    .filter(Boolean)
}

function candidateYear(work: {
  published?: { 'date-parts'?: number[][] }
  publishedPrint?: { 'date-parts'?: number[][] }
  publishedOnline?: { 'date-parts'?: number[][] }
}): number | null {
  for (const field of [
    work.publishedPrint,
    work.publishedOnline,
    work.published,
  ]) {
    const year = field?.['date-parts']?.[0]?.[0]
    if (Number.isInteger(year)) return year as number
  }
  return null
}

export function parseCrossrefWork(work: {
  DOI?: unknown
  title?: unknown
  author?: unknown
  'container-title'?: unknown
  volume?: unknown
  issue?: unknown
  page?: unknown
  published?: { 'date-parts'?: number[][] }
  publishedPrint?: { 'date-parts'?: number[][] }
  publishedOnline?: { 'date-parts'?: number[][] }
}): DoiCandidate | null {
  if (typeof work.DOI !== 'string' || !work.DOI.trim()) return null
  const titles = Array.isArray(work.title)
    ? work.title.filter(
        (t): t is string => typeof t === 'string' && t.trim() !== '',
      )
    : []
  if (!titles.length) return null
  const surnames = Array.isArray(work.author)
    ? work.author.flatMap((a) => {
        if (typeof a !== 'object' || a === null) return []
        const family = (a as { family?: unknown }).family
        return typeof family === 'string' && family.trim() ? [family] : []
      })
    : []
  const venue =
    Array.isArray(work['container-title']) &&
    typeof work['container-title'][0] === 'string' &&
    work['container-title'][0].trim()
      ? (work['container-title'][0] as string).trim()
      : null
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null
  return {
    doi: work.DOI.trim().replace(/^https?:\/\/doi\.org\//i, ''),
    titles,
    surnames,
    year: candidateYear(work),
    venue,
    volume: text(work.volume),
    issue: text(work.issue),
    pages: text(work.page),
  }
}

/**
 * Exact-match gate: one candidate title must normalize identically, at
 * least one surname must overlap, and years must agree within one.
 */
export function matchDoiCandidate(
  record: { title: string; authors: string[]; year: number | null },
  candidate: DoiCandidate,
): boolean {
  const wanted = normalizeTitle(record.title)
  if (!wanted || !candidate.titles.some((t) => normalizeTitle(t) === wanted))
    return false
  // Multi-word surnames (e.g. registry "Dela Cruz" vs stored "Dela Cruz,
  // Juan") compare on shared tokens of length 3+, never whole-string.
  const tokens = (names: string[]) =>
    new Set(
      authorSurnames(names).flatMap((s) =>
        s.split(' ').filter((t) => t.length >= 3),
      ),
    )
  const mine = tokens(record.authors)
  if (![...tokens(candidate.surnames)].some((s) => mine.has(s))) return false
  if (
    record.year !== null &&
    candidate.year !== null &&
    Math.abs(record.year - candidate.year) > 1
  )
    return false
  return true
}

export async function fetchDoiCandidates(
  title: string,
  contactEmail: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<DoiCandidate[]> {
  const params = new URLSearchParams({
    'query.title': title,
    rows: '5',
    select: 'DOI,title,author,container-title,volume,issue,page,published',
  })
  if (contactEmail) params.set('mailto', contactEmail)
  const response = await fetchFn(`${CROSSREF_URL}?${params}`, {
    headers: {
      'User-Agent': contactEmail
        ? `SULUAN/1.0 (mailto:${contactEmail})`
        : 'SULUAN/1.0',
    },
  })
  if (!response.ok) throw new Error(`Crossref ${response.status}`)
  const body = (await response.json()) as {
    message?: { items?: unknown[] }
  }
  if (!Array.isArray(body.message?.items)) return []
  return body.message.items.flatMap((item) =>
    typeof item === 'object' && item !== null
      ? [
          parseCrossrefWork(item as Parameters<typeof parseCrossrefWork>[0]),
        ].filter((c): c is DoiCandidate => c !== null)
      : [],
  )
}

export type DoiSweepResult = { checked: number; matched: number }

/**
 * Check up to `limit` accepted records never checked before. Each record
 * costs at most one Crossref call; matched rows store metadata, unmatched
 * rows store only the check timestamp so the sweep always progresses.
 */
export async function sweepDoiEnrichment(
  db: Db,
  options: {
    limit: number
    contactEmail?: string
    fetchFn?: typeof fetch
    /** Restrict to a title substring (targeted re-checks and tests). */
    titleFilter?: string
  },
): Promise<DoiSweepResult> {
  const titleClause = options.titleFilter
    ? sql`and r.title ilike ${`%${options.titleFilter}%`}`
    : sql``
  const rows = await db.execute(sql`
    select r.id, r.title, r.year,
      coalesce(author_list.names,
        (select array_agg(trimmed order by ord)
         from (select trim(line) as trimmed, ord
           from unnest(regexp_split_to_array(s.authors, E'\r?\n'))
             with ordinality as u(line, ord)) t
         where trimmed <> ''),
        '{}'::text[]) as authors
    from research_records r
    join submissions s on s.id = r.submission_id and s.status = 'ACCEPTED'
    left join lateral (
      select array_agg(a.name order by a.position, a.id) as names
      from record_authors a where a.record_id = r.id
    ) author_list on true
    where r.doi_checked_at is null
    ${titleClause}
    order by r.created_at
    limit ${options.limit}
  `)
  let matched = 0
  for (const row of rows.rows as {
    id: string
    title: string
    year: number | null
    authors: string[] | null
  }[]) {
    const record = {
      title: row.title,
      authors: row.authors ?? [],
      year: row.year,
    }
    try {
      const candidates = await fetchDoiCandidates(
        record.title,
        options.contactEmail,
        options.fetchFn,
      )
      const hit = candidates.find((c) => matchDoiCandidate(record, c))
      if (hit) {
        matched += 1
        await db.execute(sql`
          update research_records set doi = ${hit.doi}, venue = ${hit.venue},
            volume = ${hit.volume}, issue = ${hit.issue}, pages = ${hit.pages},
            pub_year = ${hit.year}, doi_source = ${DOI_SOURCE},
            doi_checked_at = now()
          where id = ${row.id}::uuid`)
      } else {
        await db.execute(sql`
          update research_records set doi_checked_at = now()
          where id = ${row.id}::uuid`)
      }
    } catch {
      // External lookup failed: leave unchecked for a later sweep run.
    }
  }
  return { checked: rows.rows.length, matched }
}
