import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  courses,
  documentEmbeddings,
  processingJobs,
  researchRecords,
  schools,
} from '@suluan/db/schema'
import {
  deleteAuditEvents,
  deleteProfiles,
  deleteSubmissions,
  insertProfile,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

function serviceRequest(
  auth: TestAuth,
  path: string,
  token: string | null,
  body?: unknown,
  envExtra?: Record<string, string>,
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (token !== null) headers.authorization = `Bearer ${token}`
  return auth.app.request(
    path,
    {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...auth.testEnv(), ...envExtra },
  )
}

describe('embedding workload identity', () => {
  let auth: TestAuth
  let mintToken: (claims: Record<string, unknown>) => Promise<string>
  beforeAll(async () => {
    auth = await setupTestAuth()
    mintToken = auth.mintToken
  })

  it('requires a Google workload token rather than a Firebase user token', async () => {
    expect(
      (await serviceRequest(auth, '/api/internal/embeddings/claim', null, {}))
        .status,
    ).toBe(401)
    const firebase = await mintToken({
      sub: 'uid-embed',
      email: 'boss@ua.edu.ph',
    })
    expect(
      (
        await serviceRequest(
          auth,
          '/api/internal/embeddings/claim',
          firebase,
          {},
        )
      ).status,
    ).toBe(401)
  })

  it('pins the exact configured service account', async () => {
    const wrong = await auth.mintServiceToken({
      email: 'other@test-project.iam.gserviceaccount.com',
    })
    expect(
      (await serviceRequest(auth, '/api/internal/embeddings/claim', wrong, {}))
        .status,
    ).toBe(401)
  })

  it('fails closed when service identity configuration is absent', async () => {
    const token = await auth.mintServiceToken()
    const env = {
      ...auth.testEnv(),
      PROCESSING_SERVICE_AUDIENCE: undefined,
      PROCESSING_SERVICE_ACCOUNT: undefined,
    }
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    }
    const res = await auth.app.request(
      '/api/internal/embeddings/claim',
      { method: 'POST', headers, body: JSON.stringify({}) },
      env,
    )
    expect(res.status).toBe(503)
  })
})

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('region-stable embedding claims', () => {
  let auth: TestAuth
  let manager: string
  let serviceToken: string
  let schoolId: string
  let courseId: string
  const tag = crypto.randomUUID().replaceAll('-', '')
  const uid = `test-embed-${tag}`
  const ids: string[] = []
  const recordIds: string[] = []
  const claimIds: string[] = []

  beforeAll(async () => {
    auth = await setupTestAuth()
    await insertProfile(testDb(), uid, `${uid}@ua.edu.ph`, 'REPOSITORY_MANAGER')
    manager = await auth.mintToken({ sub: uid, email: `${uid}@ua.edu.ph` })
    serviceToken = await auth.mintServiceToken()
    const [catalog] = await testDb()
      .select({ schoolId: schools.id, courseId: courses.id })
      .from(courses)
      .innerJoin(schools, eq(schools.id, courses.schoolId))
      .limit(1)
    ;({ schoolId, courseId } = catalog)
  })

  afterAll(async () => {
    const db = testDb()
    if (claimIds.length > 0) {
      await db.execute(
        sql`delete from embedding_claims where id in (${sql.join(
          claimIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      )
    }
    await deleteAuditEvents(db, recordIds, [uid])
    await deleteSubmissions(db, ids)
    await deleteAuditEvents(db, ids, [uid])
    await deleteProfiles(db, [uid])
  })

  /** Accepted record with keyword chunks, without any vectors. */
  async function chunkedRecord(title: string) {
    const form = new FormData()
    form.append(
      'file',
      new File(['embed test'], 'paper.pdf', { type: 'application/pdf' }),
    )
    form.append('title', title)
    form.append('authors', `Author ${tag}`)
    form.append('schoolId', schoolId)
    form.append('courseId', courseId)
    form.append('idempotencyKey', crypto.randomUUID())
    const res = await auth.app.request(
      '/api/submissions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${manager}` },
        body: form,
      },
      auth.testEnv(),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    ids.push(id)
    const decided = await auth.app.request(
      '/api/decisions',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${manager}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          submissionId: id,
          status: 'ACCEPTED',
          remarks: 'Embed claim fixture',
        }),
      },
      auth.testEnv(),
    )
    expect(decided.status).toBe(201)
    const db = testDb()
    const [record] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, id))
    recordIds.push(record.id)
    await db
      .update(processingJobs)
      .set({
        status: 'EXTRACTED',
        claimToken: crypto.randomUUID(),
        result: {
          // ~3,000 characters so the chunker yields two chunks.
          text: `${title} ${'supporting material '.repeat(150)}`,
          sha256: 'b'.repeat(64),
          parser: 'test/1',
          warnings: [],
          pageCount: 1,
        },
      })
      .where(eq(processingJobs.recordId, record.id))
    const indexed = await auth.app.request(
      '/api/search/index',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${manager}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ recordId: record.id }),
      },
      auth.testEnv(),
    )
    expect(indexed.status).toBe(200)
    return record.id
  }

  const unitVector = () => Array.from({ length: 768 }, () => 0.5)

  it('claims missing chunks, stores normalized vectors, and rejects replays', async () => {
    const recordId = await chunkedRecord(`Embed study ${tag}`)
    const claimRes = await serviceRequest(
      auth,
      '/api/internal/embeddings/claim',
      serviceToken,
      { recordId },
    )
    expect(claimRes.status).toBe(200)
    const claim = (await claimRes.json()) as {
      claimId: string
      claimToken: string
      items: { chunkId: string; content: string }[]
    }
    claimIds.push(claim.claimId)
    expect(claim.items.length).toBeGreaterThan(0)
    expect(claim.items.length).toBeLessThanOrEqual(20)
    expect(claim.items[0].content.length).toBeGreaterThan(0)

    const resultRes = await serviceRequest(
      auth,
      '/api/internal/embeddings/result',
      serviceToken,
      {
        claimToken: claim.claimToken,
        vectors: claim.items.map((item) => ({
          chunkId: item.chunkId,
          values: unitVector(),
        })),
      },
    )
    expect(resultRes.status).toBe(200)
    expect(((await resultRes.json()) as { embedded: number }).embedded).toBe(
      claim.items.length,
    )

    // Stored vectors are L2-normalized server-side, exactly once per chunk.
    const stored = await testDb()
      .select({ embedding: documentEmbeddings.embedding })
      .from(documentEmbeddings)
    expect(stored.length).toBeGreaterThanOrEqual(claim.items.length)
    for (const row of stored) {
      const raw = row.embedding as unknown
      const values = Array.isArray(raw)
        ? (raw as number[])
        : String(raw).replace(/[[\]]/g, '').split(',').map(Number)
      expect(values).toHaveLength(768)
      const norm = Math.sqrt(values.reduce((n, v) => n + v * v, 0))
      // Six-decimal literal serialization costs ~1e-5 of norm precision.
      expect(norm).toBeCloseTo(1, 4)
    }

    // Replaying a used claim cannot duplicate vectors.
    const replay = await serviceRequest(
      auth,
      '/api/internal/embeddings/result',
      serviceToken,
      {
        claimToken: claim.claimToken,
        vectors: claim.items.map((item) => ({
          chunkId: item.chunkId,
          values: unitVector(),
        })),
      },
    )
    expect(replay.status).toBe(409)

    // The record's chunks are all embedded exactly once; a scoped reclaim
    // finds nothing left.
    const empty = await serviceRequest(
      auth,
      '/api/internal/embeddings/claim',
      serviceToken,
      { recordId },
    )
    expect(empty.status).toBe(204)
  }, 60_000)

  it('rejects partial chunk sets and malformed geometry', async () => {
    const recordId = await chunkedRecord(`Embed geometry ${tag}`)
    const claimRes = await serviceRequest(
      auth,
      '/api/internal/embeddings/claim',
      serviceToken,
      { recordId },
    )
    expect(claimRes.status).toBe(200)
    const claim = (await claimRes.json()) as {
      claimId: string
      claimToken: string
      items: { chunkId: string }[]
    }
    claimIds.push(claim.claimId)

    const partial = await serviceRequest(
      auth,
      '/api/internal/embeddings/result',
      serviceToken,
      {
        claimToken: claim.claimToken,
        vectors: [{ chunkId: claim.items[0].chunkId, values: unitVector() }],
      },
    )
    expect(partial.status).toBe(claim.items.length > 1 ? 409 : 200)

    const malformed = await serviceRequest(
      auth,
      '/api/internal/embeddings/result',
      serviceToken,
      {
        claimToken: claim.claimToken,
        vectors: claim.items.map((item) => ({
          chunkId: item.chunkId,
          values: [1, 2, 3],
        })),
      },
    )
    expect([409, 422]).toContain(malformed.status)
    // Leave the shared integration corpus complete so the evaluation
    // preflight below tests its intended success path rather than inheriting
    // this fixture's deliberately incomplete claim.
    if (partial.status !== 200) {
      const completed = await serviceRequest(
        auth,
        '/api/internal/embeddings/result',
        serviceToken,
        {
          claimToken: claim.claimToken,
          vectors: claim.items.map((item) => ({
            chunkId: item.chunkId,
            values: unitVector(),
          })),
        },
      )
      expect(completed.status).toBe(200)
    }
  }, 60_000)

  it('fails evaluation preflight closed when the corpus is incomplete', async () => {
    const probes = [
      { id: 'probe-1', query: 'evaluation study' },
      { id: 'probe-2', query: 'unrelated evaluation question' },
    ]
    const claimRes = await serviceRequest(
      auth,
      '/api/internal/embeddings/evaluation/claim',
      serviceToken,
      {
        sourceSha256: 'c'.repeat(64),
        probes,
        returnArtifact: true,
      },
      {
        EMBEDDING_DAILY_REQUEST_LIMIT: '1000',
        EMBEDDING_DAILY_INPUT_LIMIT: '10000',
      },
    )
    expect(claimRes.status).toBe(409)
    expect((await claimRes.json()) as unknown).toMatchObject({
      error: 'corpus_incomplete',
    })
  }, 60_000)

  it('fails closed with 429 when the daily quota is exhausted', async () => {
    const recordId = await chunkedRecord(`Embed quota ${tag}`)
    // Pin the denial mapping with a per-request limit of one, without
    // touching the shared bucket other files consume and reset in parallel:
    // every claim past the first outstanding request is denied. Retry until
    // a denial is observed, since a parallel usage reset can reopen the
    // single-request window between attempts.
    const tiny: Record<string, string> = {
      EMBEDDING_DAILY_REQUEST_LIMIT: '1',
    }
    let denied: Response | null = null
    for (let attempt = 0; attempt < 6 && denied === null; attempt++) {
      const res = await serviceRequest(
        auth,
        '/api/internal/embeddings/claim',
        serviceToken,
        { recordId },
        tiny,
      )
      if (res.status === 200) {
        const made = (await res.json()) as { claimId: string }
        claimIds.push(made.claimId)
        continue
      }
      expect(res.status).toBe(429)
      denied = res
    }
    expect(denied).not.toBeNull()
    const body = (await (denied as Response).json()) as { error: string }
    expect(body.error).toBe('quota_exhausted')
  }, 60_000)
})
