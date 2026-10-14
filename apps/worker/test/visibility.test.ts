import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { recordAuthors, researchRecords, submissions } from '@suluan/db/schema'
import {
  deleteAuditEvents,
  deleteProfiles,
  deleteSubmissions,
  insertProfile,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

/**
 * Public/UA/manager visibility filtering plus the submitter status view.
 * Database-gated like the other route suites.
 */
const needsDb = process.env.DATABASE_URL ? describe : describe.skip
const DB_TEST_TIMEOUT = 30_000

function dbIt(name: string, test: () => Promise<void>) {
  it(name, test, DB_TEST_TIMEOUT)
}

needsDb('record visibility and submitter status', () => {
  let t: TestAuth
  const uids: string[] = []
  const submissionIds: string[] = []
  const recordIds: string[] = []
  const tag = crypto.randomUUID().replaceAll('-', '')
  const managerUid = `vis-manager-${tag}`
  const authorUid = `vis-author-${tag}`
  const otherUid = `vis-other-${tag}`
  let manager = ''
  let author = ''
  let other = ''

  beforeAll(async () => {
    t = await setupTestAuth()
    const db = testDb()
    for (const [uid, role] of [
      [managerUid, 'REPOSITORY_MANAGER'],
      [authorUid, 'USER'],
      [otherUid, 'USER'],
    ] as const) {
      await deleteSubmissions(
        db,
        (
          await db
            .select({ id: submissions.id })
            .from(submissions)
            .where(
              sql`submitter_id = (select id from profiles where firebase_uid = ${uid})`,
            )
        ).map((r) => r.id),
      )
      await deleteProfiles(db, [uid])
      await insertProfile(db, uid, `${uid}@ua.edu.ph`, role)
      uids.push(uid)
    }
    manager = await t.mintToken({
      sub: managerUid,
      email: `${managerUid}@ua.edu.ph`,
    })
    author = await t.mintToken({
      sub: authorUid,
      email: `${authorUid}@ua.edu.ph`,
    })
    other = await t.mintToken({ sub: otherUid, email: `${otherUid}@ua.edu.ph` })
  })

  afterAll(async () => {
    const db = testDb()
    await deleteAuditEvents(db, [...recordIds, ...submissionIds], uids)
    await deleteSubmissions(db, submissionIds)
    await deleteAuditEvents(db, submissionIds, uids)
    await deleteProfiles(db, uids)
  })

  function get(path: string, token: string | null) {
    return t.app.request(
      path,
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
      t.testEnv(),
    )
  }

  function post(path: string, token: string, body: unknown) {
    return t.app.request(
      path,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      t.testEnv(),
    )
  }

  async function submitPaper(title: string): Promise<string> {
    const form = new FormData()
    form.append(
      'file',
      new File(['x'.repeat(300)], 'paper.pdf', { type: 'application/pdf' }),
    )
    form.append('title', title)
    form.append('idempotencyKey', crypto.randomUUID())
    const res = await t.app.request(
      '/api/submissions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${author}` },
        body: form,
      },
      t.testEnv(),
    )
    expect(res.status).toBe(201)
    const submissionId = ((await res.json()) as { id: string }).id
    submissionIds.push(submissionId)
    return submissionId
  }

  /** Submit + decide, returning the raw result so invalid input can be asserted. */
  async function decide(
    visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED',
    embargoUntil?: string,
  ): Promise<Response & { submissionId: string; status: number }> {
    const submissionId = await submitPaper(
      `Vis ${visibility} ${tag} ${submissionIds.length}`,
    )
    const res = await post('/api/decisions', manager, {
      submissionId,
      status: 'ACCEPTED',
      remarks: 'Approved for the repository.',
      visibility,
      ...(embargoUntil ? { embargoUntil } : {}),
    })
    if (res.status === 201) {
      const [record] = await testDb()
        .select()
        .from(researchRecords)
        .where(eq(researchRecords.submissionId, submissionId))
      recordIds.push(record.id)
    }
    return Object.assign(res, { submissionId })
  }

  async function acceptWith(
    visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED',
    embargoUntil?: string,
  ): Promise<{ recordId: string; submissionId: string }> {
    const res = await decide(visibility, embargoUntil)
    expect(res.status).toBe(201)
    const [record] = await testDb()
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, res.submissionId))
    return { recordId: record.id, submissionId: res.submissionId }
  }

  dbIt(
    'records manager-selected visibility and rejects invalid embargo input',
    async () => {
      const ok = await acceptWith('UA_ONLY')
      const db = testDb()
      const [row] = await db
        .select()
        .from(researchRecords)
        .where(eq(researchRecords.id, ok.recordId))
      expect(row.visibility).toBe('UA_ONLY')
      expect(row.embargoUntil).toBeNull()

      // An embargo date in the past is rejected before anything is persisted.
      const past = await decide('UA_ONLY', '2020-01-01')
      expect(past.status).toBe(400)
      // Approved policy: a date on a PUBLIC record is a no-op, stored as NULL.
      const onPublic = await decide('PUBLIC', '2099-01-01')
      expect(onPublic.status).toBe(201)
      const [publicRow] = await db
        .select()
        .from(researchRecords)
        .where(eq(researchRecords.submissionId, onPublic.submissionId))
      expect(publicRow.visibility).toBe('PUBLIC')
      expect(publicRow.embargoUntil).toBeNull()
      // Restricted visibility with a future date is accepted and stored.
      const future = await decide('RESTRICTED', '2099-01-01')
      expect(future.status).toBe(201)
      const [stored] = await db
        .select()
        .from(researchRecords)
        .where(eq(researchRecords.submissionId, future.submissionId))
      expect(stored.visibility).toBe('RESTRICTED')
      expect(stored.embargoUntil).toBe('2099-01-01')
      recordIds.push(stored.id)
    },
  )

  dbIt(
    'limits anonymous search to PUBLIC records without a live embargo',
    async () => {
      const publicPaper = await acceptWith('PUBLIC')
      const uaOnly = await acceptWith('UA_ONLY')
      const restricted = await acceptWith('RESTRICTED')

      // Scope by this suite's tag: other suites' fixtures may exist in parallel.
      const scoped = `/api/search/records?q=${tag}`
      const anon = await get(scoped, null)
      expect(anon.status).toBe(200)
      // Anonymous results are identical for everyone, so short-lived caching
      // is safe; authenticated responses must never be stored.
      expect(anon.headers.get('cache-control')).toContain('public')
      const ids = (
        (await anon.json()) as { items: { id: string }[] }
      ).items.map((i) => i.id)
      expect(ids).toContain(publicPaper.recordId)
      expect(ids).not.toContain(uaOnly.recordId)
      expect(ids).not.toContain(restricted.recordId)

      const uaRes = await get(scoped, author)
      expect(uaRes.headers.get('cache-control')).toBe('private, no-store')
      const uaIds = (
        (await uaRes.json()) as { items: { id: string }[] }
      ).items.map((i) => i.id)
      expect(uaIds).toContain(publicPaper.recordId)
      expect(uaIds).toContain(uaOnly.recordId)
      expect(uaIds).not.toContain(restricted.recordId)

      const mgrRes = await get(scoped, manager)
      const mgrIds = (
        (await mgrRes.json()) as { items: { id: string }[] }
      ).items.map((i) => i.id)
      expect(mgrIds).toContain(restricted.recordId)
    },
  )

  dbIt('keeps unverifiable credentials out of shared caches', async () => {
    const publicPaper = await acceptWith('PUBLIC')
    const scoped = `/api/search/records?q=${tag}`

    // No credential: anonymous body, publicly cacheable.
    const anon = await get(scoped, null)
    expect(anon.status).toBe(200)
    expect(anon.headers.get('cache-control')).toContain('public')
    const anonIds = (
      (await anon.json()) as { items: { id: string }[] }
    ).items.map((i) => i.id)
    expect(anonIds).toContain(publicPaper.recordId)

    // Stale credential: the same anonymous body and status (degrade, don't
    // fail), but a shared cache must not store the response.
    const stale = await get(scoped, 'not-a-token')
    expect(stale.status).toBe(200)
    expect(stale.headers.get('cache-control')).toBe('private, no-store')
    const staleIds = (
      (await stale.json()) as { items: { id: string }[] }
    ).items.map((i) => i.id)
    expect(staleIds).toEqual(anonIds)

    // Same rule on downloads: the public paper still streams, privately.
    const dl = await get(
      `/api/records/${publicPaper.recordId}/download`,
      'not-a-token',
    )
    expect(dl.status).toBe(200)
    expect(dl.headers.get('cache-control')).toBe('private, no-store')
  })

  dbIt(
    'degrades an embargoed PUBLIC record to UA-only for visitors',
    async () => {
      // The API no-ops a date on PUBLIC, so this defensive read-side rule is
      // arranged directly in Neon (ops imports can produce such a row).
      const paper = await acceptWith('PUBLIC')
      await testDb()
        .update(researchRecords)
        .set({ embargoUntil: '2099-01-01' })
        .where(eq(researchRecords.id, paper.recordId))
      const anon = await get(`/api/search/records?q=${tag}`, null)
      const body = (await anon.json()) as {
        items: { id: string; visibility: string }[]
      }
      expect(body.items.map((i) => i.id)).not.toContain(paper.recordId)
      const uaRes = await get(`/api/search/records?q=${tag}`, author)
      const uaBody = (await uaRes.json()) as {
        items: { id: string; visibility: string }[]
      }
      const row = uaBody.items.find((i) => i.id === paper.recordId)
      // A signed-in UA user sees it, labeled as UA-only rather than public.
      expect(row?.visibility).toBe('UA_ONLY')
    },
  )

  dbIt(
    'auto-lifts a restricted record to public once its embargo elapses',
    async () => {
      // A past date is rejected at input, so the elapsed-embargo state is
      // arranged directly in Neon to exercise the read-side auto-lift.
      const paper = await acceptWith('RESTRICTED', '2099-01-01')
      const yesterday = new Date(Date.now() - 86_400_000)
        .toISOString()
        .slice(0, 10)
      await testDb()
        .update(researchRecords)
        .set({ embargoUntil: yesterday })
        .where(eq(researchRecords.id, paper.recordId))
      const anon = await get(`/api/search/records?q=${tag}`, null)
      const body = (await anon.json()) as {
        items: { id: string; visibility: string }[]
      }
      const row = body.items.find((i) => i.id === paper.recordId)
      expect(row?.visibility).toBe('PUBLIC')
    },
  )

  dbIt(
    'serves downloads by visibility and never confirms hidden records',
    async () => {
      const publicPaper = await acceptWith('PUBLIC')
      const restricted = await acceptWith('RESTRICTED')
      // The intake flow already stored the bytes in the R2 mock under the
      // server-owned key, so both records are downloadable.

      const anonOk = await get(
        `/api/records/${publicPaper.recordId}/download`,
        null,
      )
      expect(anonOk.status).toBe(200)
      expect(anonOk.headers.get('cache-control')).toContain('public')

      // Same 404 for anonymous and UA viewers: no 403 that confirms existence.
      expect(
        (await get(`/api/records/${restricted.recordId}/download`, null))
          .status,
      ).toBe(404)
      expect(
        (await get(`/api/records/${restricted.recordId}/download`, author))
          .status,
      ).toBe(404)

      const mgrOk = await get(
        `/api/records/${restricted.recordId}/download`,
        manager,
      )
      expect(mgrOk.status).toBe(200)

      // A pending submission has no record row, so it is unreachable here.
      const form = new FormData()
      form.append(
        'file',
        new File(['z'], 'pending.pdf', { type: 'application/pdf' }),
      )
      form.append('title', 'Pending probe')
      form.append('idempotencyKey', crypto.randomUUID())
      const created = await t.app.request(
        '/api/submissions',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${author}` },
          body: form,
        },
        t.testEnv(),
      )
      submissionIds.push(((await created.json()) as { id: string }).id)
      const probe = await get(
        `/api/records/${crypto.randomUUID()}/download`,
        manager,
      )
      expect(probe.status).toBe(404)
    },
  )

  dbIt(
    'serves metadata details with the same visibility policy as search',
    async () => {
      const publicPaper = await acceptWith('PUBLIC')
      const uaOnly = await acceptWith('UA_ONLY')
      const restricted = await acceptWith('RESTRICTED')

      const publicDetail = await get(
        `/api/records/${publicPaper.recordId}`,
        null,
      )
      expect(publicDetail.status).toBe(200)
      expect(publicDetail.headers.get('cache-control')).toContain('public')
      const publicBody = (await publicDetail.json()) as {
        id: string
        title: string
        visibility: string
        keywords: string[]
        authorList: string[]
      }
      expect(publicBody.id).toBe(publicPaper.recordId)
      expect(publicBody.title).toContain(tag)
      expect(publicBody.visibility).toBe('PUBLIC')
      expect(publicBody.keywords).toEqual([])
      // Fixtures submit no authors, so the ordered list falls back to empty.
      expect(publicBody.authorList).toEqual([])

      // Ordered repository authors are exposed verbatim for citation use.
      await testDb()
        .insert(recordAuthors)
        .values([
          { recordId: publicPaper.recordId, name: 'Second, Bea', position: 1 },
          { recordId: publicPaper.recordId, name: 'First, Ana', position: 0 },
        ])
      const withAuthors = (await (
        await get(`/api/records/${publicPaper.recordId}`, null)
      ).json()) as { authorList: string[] }
      expect(withAuthors.authorList).toEqual(['First, Ana', 'Second, Bea'])

      // UA-only and restricted records use the same 404 boundary for visitors,
      // while authorized viewers receive metadata.
      expect((await get(`/api/records/${uaOnly.recordId}`, null)).status).toBe(
        404,
      )
      expect(
        (await get(`/api/records/${uaOnly.recordId}`, author)).status,
      ).toBe(200)
      expect(
        (await get(`/api/records/${restricted.recordId}`, author)).status,
      ).toBe(404)
      expect(
        (await get(`/api/records/${restricted.recordId}`, manager)).status,
      ).toBe(200)
    },
  )

  dbIt('shows a submitter only their own status and remarks', async () => {
    const mine = await acceptWith('PUBLIC')
    const mineRes = await get('/api/submissions/mine', author)
    expect(mineRes.status).toBe(200)
    const rows = (await mineRes.json()) as {
      id: string
      status: string
      remarks: string | null
      recordId: string | null
      effectiveVisibility: string | null
    }[]
    const row = rows.find((r) => r.id === mine.submissionId)
    expect(row?.status).toBe('ACCEPTED')
    expect(row?.remarks).toContain('Approved')
    expect(row?.effectiveVisibility).toBe('PUBLIC')

    // Another UA user cannot see this submitter's rows.
    const otherRes = await get('/api/submissions/mine', other)
    const otherRows = (await otherRes.json()) as { id: string }[]
    expect(otherRows.map((r) => r.id)).not.toContain(mine.submissionId)

    // Anonymous callers are rejected outright.
    expect((await get('/api/submissions/mine', null)).status).toBe(401)

    // The submitter still has no access to their own intake file download.
    expect(
      (await get(`/api/submissions/${mine.submissionId}/download`, author))
        .status,
    ).toBe(403)
  })
})
