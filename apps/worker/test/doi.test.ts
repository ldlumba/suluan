import { afterAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { profiles, researchRecords, submissions } from '@suluan/db/schema'
import {
  authorSurnames,
  fetchDoiCandidates,
  matchDoiCandidate,
  normalizeTitle,
  parseCrossrefWork,
  sweepDoiEnrichment,
  type DoiCandidate,
} from '../src/doi'
import {
  deleteProfiles,
  deleteSubmissions,
  insertProfile,
  testDb,
} from './helpers'

describe('doi matching policy', () => {
  it('normalizes titles across case, punctuation, and spacing', () => {
    expect(normalizeTitle('SoilScope:  Integrating AI—into Diagnostics!')).toBe(
      'soilscope integrating ai into diagnostics',
    )
  })

  it('extracts surnames from stored and registry names', () => {
    expect(authorSurnames(['Dela Cruz, Juan', 'Solo'])).toEqual([
      'dela cruz',
      'solo',
    ])
    expect(authorSurnames(['Miclat, J. H. S.'])).toEqual(['miclat'])
  })

  const record = {
    title: 'SoilScope: Integrating AI into Soil Diagnostics',
    authors: ['Miclat, Juan H. S.', 'Suba, Jose M.'],
    year: 2026,
  }
  const base: DoiCandidate = {
    doi: '10.36948/ijfmr.2026.v08i03.79352',
    titles: ['SoilScope: Integrating AI Into Soil Diagnostics'],
    surnames: ['Miclat', 'Suba'],
    year: 2026,
    venue: 'International Journal for Multidisciplinary Research',
    volume: '8',
    issue: '3',
    pages: '1-10',
  }

  it('accepts exact title plus author and year agreement', () => {
    expect(matchDoiCandidate(record, base)).toBe(true)
  })

  it('rejects near-title, author, and year mismatches', () => {
    expect(
      matchDoiCandidate(record, { ...base, titles: ['SoilScope II'] }),
    ).toBe(false)
    expect(matchDoiCandidate(record, { ...base, surnames: ['Reyes'] })).toBe(
      false,
    )
    expect(matchDoiCandidate(record, { ...base, year: 2020 })).toBe(false)
    expect(matchDoiCandidate({ ...record, year: null }, base)).toBe(true)
  })

  it('parses Crossref works and rejects bare DOIs or titles', () => {
    expect(
      parseCrossrefWork({
        DOI: 'https://doi.org/10.1/x',
        title: ['Study'],
        author: [{ family: 'Cruz' }],
        'container-title': ['Journal'],
        volume: '8',
        issue: '3',
        page: '1-5',
        published: { 'date-parts': [[2026]] },
      }),
    ).toMatchObject({ doi: '10.1/x', venue: 'Journal', year: 2026 })
    expect(parseCrossrefWork({ DOI: '10.1/x', title: [] })).toBeNull()
    expect(parseCrossrefWork({ title: ['Study'] })).toBeNull()
  })

  it('queries Crossref titles and drops invalid items', async () => {
    const calls: string[] = []
    const fetchFn = (async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        json: async () => ({
          message: { items: [{ DOI: '10.1/x', title: ['T'] }, null] },
        }),
      }
    }) as unknown as typeof fetch
    const out = await fetchDoiCandidates('T', 'test@ua.edu.ph', fetchFn)
    expect(out).toHaveLength(1)
    expect(calls[0]).toContain('api.crossref.org')
    expect(calls[0]).toContain('mailto=test%40ua.edu.ph')
  })
})

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('doi enrichment sweep', () => {
  const tag = crypto.randomUUID().replaceAll('-', '')
  const uid = `doi-sweep-${tag}`
  const submissionIds: string[] = []

  async function makeRecord(title: string, authors: string) {
    const db = testDb()
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.firebaseUid, uid))
    const [submission] = await db
      .insert(submissions)
      .values({
        submitterId: profile.id,
        status: 'ACCEPTED',
        idempotencyKey: crypto.randomUUID(),
        title,
        normalizedTitle: title.toLowerCase(),
        authors,
      })
      .returning()
    submissionIds.push(submission.id)
    const [record] = await db
      .insert(researchRecords)
      .values({ submissionId: submission.id, title, year: 2026 })
      .returning()
    return record
  }

  afterAll(async () => {
    const db = testDb()
    await deleteSubmissions(db, submissionIds)
    await deleteProfiles(db, [uid])
  })

  it('attaches exact matches and marks misses checked without guessing', async () => {
    const db = testDb()
    await insertProfile(db, uid, `${uid}@ua.edu.ph`, 'USER')
    const hit = await makeRecord(
      `Doi Hit ${tag}`,
      'Dela Cruz, Juan\nSantos, Maria',
    )
    const miss = await makeRecord(`Doi Miss ${tag}`, 'Reyes, Ana')
    const fetchFn = (async () => ({
      ok: true,
      json: async () => ({
        message: {
          items: [
            {
              DOI: '10.1/match',
              title: [`Doi Hit ${tag}`],
              author: [{ family: 'Dela Cruz' }],
              'container-title': ['Test Journal'],
              volume: '8',
              issue: '3',
              page: '10-20',
              published: { 'date-parts': [[2026]] },
            },
          ],
        },
      }),
    })) as unknown as typeof fetch
    const first = await sweepDoiEnrichment(db, {
      limit: 5,
      fetchFn,
      titleFilter: tag,
    })
    expect(first.checked).toBe(2)
    expect(first.matched).toBe(1)
    const [stored] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.id, hit.id))
    expect(stored.doi).toBe('10.1/match')
    expect(stored.venue).toBe('Test Journal')
    expect(stored.doiCheckedAt).not.toBeNull()
    const [missed] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.id, miss.id))
    expect(missed.doi).toBeNull()
    expect(missed.doiCheckedAt).not.toBeNull()
    // Checked rows are never re-queried.
    const second = await sweepDoiEnrichment(db, {
      limit: 5,
      fetchFn,
      titleFilter: tag,
    })
    expect(second.checked).toBe(0)
  }, 30_000)

  it('leaves rows unchecked when lookup fails', async () => {
    const db = testDb()
    const pending = await makeRecord(`Doi Pending ${tag}`, 'Cruz, Ana')
    const failing = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const out = await sweepDoiEnrichment(db, {
      limit: 5,
      fetchFn: failing,
      titleFilter: tag,
    })
    expect(out).toEqual({ checked: 1, matched: 0 })
    const [row] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.id, pending.id))
    expect(row.doi).toBeNull()
    expect(row.doiCheckedAt).toBeNull()
  }, 30_000)
})
