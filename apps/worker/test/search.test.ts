import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  courses,
  processingJobs,
  researchRecords,
  schools,
  submissions,
} from '@suluan/db/schema'
import {
  setupTestAuth,
  insertProfile,
  testDb,
  deleteSubmissions,
  deleteAuditEvents,
  deleteProfiles,
  type TestAuth,
} from './helpers'

const needsDb = process.env.DATABASE_URL ? describe : describe.skip
const DB_TEST_TIMEOUT = 30_000

function dbIt(name: string, test: () => Promise<void>) {
  it(name, test, DB_TEST_TIMEOUT)
}

needsDb('restricted keyword discovery', () => {
  let t: TestAuth
  let manager: string
  let user: string
  let courseId: string
  let courseName: string
  let schoolId: string
  let schoolName: string
  const tag = crypto.randomUUID().replaceAll('-', '')
  const uid = `test-search-${tag}`
  const userUid = `test-search-user-${tag}`
  const ids: string[] = []
  const recordIds: string[] = []
  beforeAll(async () => {
    t = await setupTestAuth()
    await insertProfile(testDb(), uid, `${uid}@ua.edu.ph`, 'REPOSITORY_MANAGER')
    manager = await t.mintToken({ sub: uid, email: `${uid}@ua.edu.ph` })
    user = await t.mintToken({ sub: userUid, email: `${userUid}@ua.edu.ph` })
    const [catalog] = await testDb()
      .select({
        courseId: courses.id,
        courseName: courses.name,
        schoolId: schools.id,
        schoolName: schools.name,
      })
      .from(courses)
      .innerJoin(schools, eq(schools.id, courses.schoolId))
      .limit(1)
    ;({ courseId, courseName, schoolId, schoolName } = catalog)
  })
  afterAll(async () => {
    const db = testDb()
    await deleteAuditEvents(db, recordIds, [uid, userUid])
    await deleteSubmissions(db, ids)
    await deleteAuditEvents(db, ids, [uid, userUid])
    await deleteProfiles(db, [uid, userUid])
  })
  function request(path: string, token: string | null, body?: unknown) {
    return t.app.request(
      path,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      t.testEnv(),
    )
  }
  async function fixture(
    status: 'PENDING' | 'ACCEPTED' | 'REJECTED',
    extracted = true,
    title = `Study ${tag}`,
    authors = `Author ${tag}`,
  ) {
    const form = new FormData()
    form.append(
      'file',
      new File(['test'], 'paper.pdf', { type: 'application/pdf' }),
    )
    form.append('title', title)
    form.append('authors', authors)
    form.append('schoolId', schoolId)
    form.append('courseId', courseId)
    form.append('idempotencyKey', crypto.randomUUID())
    const res = await t.app.request(
      '/api/submissions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${manager}` },
        body: form,
      },
      t.testEnv(),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    ids.push(id)
    if (status !== 'PENDING')
      expect(
        (
          await request('/api/decisions', manager, {
            submissionId: id,
            status,
            remarks: 'Test fixture',
          })
        ).status,
      ).toBe(201)
    if (status !== 'ACCEPTED') return { id }
    const db = testDb()
    const [record] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, id))
    recordIds.push(record.id)
    if (extracted)
      await db
        .update(processingJobs)
        .set({
          status: 'EXTRACTED',
          claimToken: crypto.randomUUID(),
          result: {
            text: `photovoltaic ${tag}\n\n<script>alert('untrusted')</script> study   evidence ${'supporting material '.repeat(30)}`,
            sha256: 'a'.repeat(64),
            parser: 'test/1',
            warnings: [],
            pageCount: 1,
          },
        })
        .where(eq(processingJobs.recordId, record.id))
    return { id, recordId: record.id }
  }
  dbIt('allows public reads but keeps preparation manager-only', async () => {
    // Discovery is public (owner-approved 2026-10-01); only PUBLIC records
    // with an elapsed embargo are visible, enforced by the visibility filter.
    expect((await request('/api/search/records?q=private', null)).status).toBe(
      200,
    )
    expect((await request('/api/search/records?q=private', user)).status).toBe(
      200,
    )
    // Preparation writes keyword snapshots, so it stays manager-only.
    expect((await request('/api/search/index', null, {})).status).toBe(401)
    expect((await request('/api/search/index', user, {})).status).toBe(403)
  })
  dbIt('validates sorting and orders keyword matches by title', async () => {
    const sortTag = `sort${crypto.randomUUID().replaceAll('-', '')}`
    const zulu = await fixture(
      'ACCEPTED',
      false,
      `Zulu ${sortTag}`,
      `Author ${sortTag}`,
    )
    const alpha = await fixture(
      'ACCEPTED',
      false,
      `Alpha ${sortTag}`,
      `Author ${sortTag}`,
    )
    const response = await request(
      `/api/search/records?q=${sortTag}&sort=title`,
      manager,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: { id: string }[] }
    expect(body.items.map((item) => item.id)).toEqual([
      alpha.recordId,
      zulu.recordId,
    ])
    expect((await request('/api/search/records?sort=invalid', manager)).status).toBe(
      400,
    )
  })
  dbIt('indexes idempotently, matches full text and metadata, and excludes pending/rejected/queued records', async () => {
    const accepted = await fixture('ACCEPTED')
    const queued = await fixture('ACCEPTED', false)
    await fixture('PENDING')
    await fixture('REJECTED')
    const prepared = await Promise.all(
      [1, 2].map(() =>
        request('/api/search/index', manager, { recordId: accepted.recordId }),
      ),
    )
    for (const response of prepared) expect(response.status).toBe(200)
    const counts = await Promise.all(
      prepared.map((r) => r.json() as Promise<{ indexed: number }>),
    )
    expect(counts.reduce((n, r) => n + r.indexed, 0)).toBe(1)
    expect(
      await (
        await request('/api/search/index', manager, {
          recordId: queued.recordId,
        })
      ).json(),
    ).toMatchObject({ indexed: 0 })
    // Full-text-only terms match just the extracted record; title/author
    // metadata matches both the READY record and the still-queued one.
    const fullText = await request(
      `/api/search/records?q=${encodeURIComponent(`photovoltaic ${tag}`)}`,
      manager,
    )
    expect(fullText.status).toBe(200)
    expect(fullText.headers.get('cache-control')).toContain('no-store')
    const fullTextBody = (await fullText.json()) as {
      items: { id: string; fullTextStatus: string; snippet: string | null }[]
    }
    expect(fullTextBody.items.map((x) => x.id)).toEqual([accepted.recordId])
    expect(fullTextBody.items[0].fullTextStatus).toBe('READY')
    expect(fullTextBody.items[0].snippet).not.toMatch(/\s{2,}/)
    expect(fullTextBody.items[0].snippet).toMatch(/…$/)
    expect(fullTextBody.items[0].snippet!.length).toBeLessThanOrEqual(401)
    const browseBody = (await (
      await request('/api/search/records?q=&sort=newest', manager)
    ).json()) as { items: { id: string; snippet: string | null }[] }
    expect(
      browseBody.items.find((item) => item.id === accepted.recordId)?.snippet,
    ).toBeNull()
    for (const query of [`Study ${tag}`, `Author ${tag}`]) {
      const response = await request(
        `/api/search/records?q=${encodeURIComponent(query)}`,
        manager,
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        items: {
          id: string
          fullTextStatus: string
          snippet: string | null
          schoolName: string | null
          courseName: string | null
        }[]
      }
      // Both records match by metadata; their relative order is rank detail.
      expect(body.items.map((x) => x.id).sort()).toEqual(
        [accepted.recordId, queued.recordId].sort(),
      )
      const pending = body.items.find((x) => x.id === queued.recordId)!
      expect(pending.fullTextStatus).toBe('PENDING')
      expect(pending.snippet).toBeNull()
      expect(pending.schoolName).toBe(schoolName)
      expect(pending.courseName).toBe(courseName)
    }
    // Failed extraction keeps the accepted record visible by metadata only:
    // labeled FAILED, no snippet, excluded from full-text ranking.
    const db = testDb()
    await db
      .update(processingJobs)
      .set({ status: 'FAILED' })
      .where(eq(processingJobs.recordId, accepted.recordId!))
    const failedBody = (await (
      await request(`/api/search/records?q=${tag}`, manager)
    ).json()) as {
      items: { id: string; fullTextStatus: string; snippet: string | null }[]
    }
    // Both the failed record and the still-queued record match by metadata.
    expect(failedBody.items.map((x) => x.id).sort()).toEqual(
      [accepted.recordId, queued.recordId].sort(),
    )
    const failedItem = failedBody.items.find(
      (x) => x.id === accepted.recordId,
    )!
    expect(failedItem.fullTextStatus).toBe('FAILED')
    expect(failedItem.snippet).toBeNull()
    expect(
      failedBody.items.find((x) => x.id === queued.recordId)!.fullTextStatus,
    ).toBe('PENDING')
    await db
      .update(processingJobs)
      .set({ status: 'EXTRACTED' })
      .where(eq(processingJobs.recordId, accepted.recordId!))
    // Rejecting the submission hides it; the still-accepted queued record
    // remains visible by metadata.
    await db
      .update(submissions)
      .set({ status: 'REJECTED' })
      .where(eq(submissions.id, accepted.id))
    const rejectedBody = (await (
      await request(`/api/search/records?q=${tag}`, manager)
    ).json()) as { items: { id: string }[] }
    expect(rejectedBody.items.map((x) => x.id)).toEqual([queued.recordId])
    await db
      .update(submissions)
      .set({ status: 'ACCEPTED' })
      .where(eq(submissions.id, accepted.id))
    const chunks = await db.execute(
      sql`select count(*)::int as n from document_chunks d join keyword_indexes i on i.id = d.index_id where i.record_id = ${accepted.recordId}`,
    )
    expect(chunks.rows[0].n).toBe(1)
    expect((await request('/api/search/records?page=0', manager)).status).toBe(
      400,
    )
    expect(
      (await request(`/api/search/records?q=${'a'.repeat(201)}`, manager))
        .status,
    ).toBe(400)
  })
})
