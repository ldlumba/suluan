import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { EMBEDDING_DIMS, researchRecords, submissions } from '@suluan/db/schema'
import { CHUNKER_VERSION } from '../src/chunking'
import { MAX_SEMANTIC_DISTANCE } from '../src/search'
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
 * Semantic search end to end against Neon, with only the Gemini HTTP call
 * stubbed. neon-http also uses global fetch, so the stub must delegate
 * non-Gemini traffic back to the real implementation.
 */
const needsDb = process.env.DATABASE_URL ? describe : describe.skip
const realFetch = globalThis.fetch
const GEMINI_HOST = 'generativelanguage.googleapis.com'
const DB_TEST_TIMEOUT = 30_000

function dbIt(name: string, test: () => Promise<void>) {
  it(name, test, DB_TEST_TIMEOUT)
}

needsDb('semantic search', () => {
  let t: TestAuth
  const uids: string[] = []
  const submissionIds: string[] = []
  const recordIds: string[] = []
  const tag = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
  let manager = ''
  let author = ''
  let managerProfileId = ''

  /** Deterministic embedder: index 0 = weight on the first word of the text. */
  function stubGemini(): { calls: number; inputs: number } {
    const stats = { calls: 0, inputs: 0 }
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes(GEMINI_HOST)) return realFetch(input, init)
      stats.calls += 1
      const body = JSON.parse(String(init?.body)) as {
        requests: { content: { parts: { text: string }[] } }[]
      }
      const embeddings = body.requests.map((request) => {
        stats.inputs += 1
        const text = request.content.parts[0].text
        const values = new Array(EMBEDDING_DIMS).fill(0)
        // Deterministic "which token" signature so ranking is assertable.
        for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
          let hash = 0
          for (const ch of token) hash = (hash * 31 + ch.charCodeAt(0)) % EMBEDDING_DIMS
          values[hash] = Math.min(1, values[hash] + 0.1)
        }
        return { values }
      })
      return new Response(JSON.stringify({ embeddings }), { status: 200 })
    })
    return stats
  }

  /**
   * Controlled unit vectors for the relevance-floor regression. Ordinary
   * queries are e0; the no-match query is a dense vector far from every sparse
   * fixture vector. Documents choose their vector by marker in the test text:
   * - close / restricted: e0, distance 0
   * - boundary: dot(query, doc) = 0.3, distance exactly 0.7
   * - far: e1, distance 1
   */
  function stubThresholdGemini(): { calls: number; inputs: number } {
    const stats = { calls: 0, inputs: 0 }
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes(GEMINI_HOST)) return realFetch(input, init)
      stats.calls += 1
      const body = JSON.parse(String(init?.body)) as {
        requests: {
          taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'
          content: { parts: { text: string }[] }
        }[]
      }
      const embeddings = body.requests.map((request) => {
        stats.inputs += 1
        const text = request.content.parts[0].text
        const values = new Array(EMBEDDING_DIMS).fill(0)
        if (
          request.taskType === 'RETRIEVAL_QUERY' &&
          text.includes('threshold-no-match')
        ) {
          values.fill(1)
        } else if (
          request.taskType === 'RETRIEVAL_QUERY' ||
          text.includes('threshold-close')
        ) {
          values[0] = 1
        } else if (text.includes('threshold-boundary')) {
          values[0] = 0.3
          values[1] = Math.sqrt(1 - 0.3 ** 2)
        } else if (text.includes('threshold-restricted')) {
          values[0] = 1
        } else {
          values[1] = 1
        }
        return { values }
      })
      return new Response(JSON.stringify({ embeddings }), { status: 200 })
    })
    return stats
  }

  beforeAll(async () => {
    t = await setupTestAuth()
    const db = testDb()
    for (const [uid, role] of [
      [`sem-mgr-${tag}`, 'REPOSITORY_MANAGER'],
      [`sem-author-${tag}`, 'USER'],
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
      const profile = await insertProfile(db, uid, `${uid}@ua.edu.ph`, role)
      if (role === 'REPOSITORY_MANAGER') managerProfileId = profile.id
      uids.push(uid)
    }
    manager = await t.mintToken({
      sub: `sem-mgr-${tag}`,
      email: `sem-mgr-${tag}@ua.edu.ph`,
    })
    author = await t.mintToken({
      sub: `sem-author-${tag}`,
      email: `sem-author-${tag}@ua.edu.ph`,
    })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    const db = testDb()
    // Usage counters are keyed by profile id, not uid, so clear by bucket.
    await db.execute(sql`delete from embedding_usage`)
    await deleteAuditEvents(db, [...recordIds, ...submissionIds], uids)
    await deleteSubmissions(db, submissionIds)
    await deleteAuditEvents(db, submissionIds, uids)
    await deleteProfiles(db, uids)
    expect(managerProfileId).toBeTruthy()
  })

  function env(extra: Record<string, string> = {}) {
    return { ...t.testEnv(), GEMINI_API_KEY: 'AQ.test-key', ...extra }
  }

  function get(path: string, token: string | null, extra: Record<string, string> = {}) {
    return t.app.request(
      path,
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
      env(extra),
    )
  }

  function post(path: string, token: string, body: unknown) {
    return t.app.request(
      path,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env(),
    )
  }

  /** Submit, accept, and arrange a keyword snapshot with one or more chunks. */
  async function paper(
    visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED',
    text: string | string[],
  ) {
    const chunkTexts = Array.isArray(text) ? text : [text]
    const form = new FormData()
    form.append('file', new File(['x'.repeat(300)], 'paper.pdf', { type: 'application/pdf' }))
    form.append('title', `Sem ${visibility} ${tag}`)
    form.append('idempotencyKey', crypto.randomUUID())
    const created = await t.app.request(
      '/api/submissions',
      { method: 'POST', headers: { authorization: `Bearer ${author}` }, body: form },
      env(),
    )
    expect(created.status).toBe(201)
    const submissionId = ((await created.json()) as { id: string }).id
    submissionIds.push(submissionId)
    const decided = await post('/api/decisions', manager, {
      submissionId,
      status: 'ACCEPTED',
      remarks: 'Accepted.',
      visibility,
    })
    expect(decided.status).toBe(201)

    // Keyword preparation first: embeddings are children of a keyword snapshot.
    const chunker = testDb()
    const [record] = await chunker
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, submissionId))
    recordIds.push(record.id)
    // Parameterized inserts rather than raw literals: Postgres cannot infer a
    // type for an uncast parameter, which is what broke the first version.
    const inserted = await chunker.execute(sql`
      insert into keyword_indexes
        (record_id, extraction_claim_token, chunker_version, source_sha256)
      values (${record.id}, ${crypto.randomUUID()}::uuid,
        ${CHUNKER_VERSION}::text, ${`sem-${tag}-${visibility}`}::text)
      on conflict do nothing
      returning id
    `)
    const keywordIndex = inserted.rows[0] as { id: string }
    const chunks = chunkTexts.map((content, ordinal) => ({
      ordinal,
      startOffset: ordinal * 2000,
      endOffset: ordinal * 2000 + content.length,
      content,
    }))
    await testDb().execute(sql`
      insert into document_chunks
        (index_id, ordinal, start_offset, end_offset, content)
      select ${keywordIndex.id}::uuid, x.ordinal, x."startOffset",
        x."endOffset", x.content
      from jsonb_to_recordset(${JSON.stringify(chunks)}::jsonb)
        as x(ordinal integer, "startOffset" integer, "endOffset" integer,
          content text)
    `)
    return { recordId: record.id, submissionId, keywordIndexId: keywordIndex.id }
  }

  async function embedAll(recordId?: string) {
    const res = await post('/api/search/semantic/prepare', manager, { recordId })
    expect(res.status).toBe(200)
    return (await res.json()) as { embedded: number; papers: number; hasMore: boolean }
  }

  beforeEach(async () => {
    // Quota counters are per UTC day, so each test starts from a clean slate.
    await testDb().execute(sql`delete from embedding_usage`)
    stubGemini()
  })

  dbIt('reports unconfigured when no key is present and does not call out', async () => {
    const calls = stubGemini()
    const res = await t.app.request(
      '/api/search/semantic?q=test',
      { headers: {} },
      { ...t.testEnv(), GEMINI_API_KEY: '' },
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { semanticStatus: string }).semanticStatus).toBe(
      'unconfigured',
    )
    expect(calls.calls).toBe(0)
  })

  dbIt('rejects preparation for anonymous and ordinary users', async () => {
    expect((await get('/api/search/semantic/prepare', null)).status).toBe(404)
    const anon = await t.app.request(
      '/api/search/semantic/prepare',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env(),
    )
    expect(anon.status).toBe(401)
    expect((await post('/api/search/semantic/prepare', author, {})).status).toBe(403)
  })

  dbIt('embeds once and is idempotent across repeated preparations', async () => {
    const p = await paper('PUBLIC', `solar ${tag} photovoltaic efficiency`)
    const first = await embedAll(p.recordId)
    expect(first.embedded).toBe(1)
    // Repeat the SAME scoped call: it must be a no-op. Asserting on a bulk
    // call instead would be flaky, because other suites' keyword snapshots are
    // legitimately eligible for a bulk prepare.
    const second = await embedAll(p.recordId)
    expect(second.embedded).toBe(0)
    const rows = await testDb().execute(sql`
      select count(*)::int as n from document_embeddings
      where semantic_index_id in (
        select id from semantic_indexes where keyword_index_id = ${p.keywordIndexId}
      )
    `)
    expect(rows.rows[0].n).toBe(1)
  })

  dbIt('embeds every chunk, repairs a partial snapshot, then converges to zero', async () => {
    // A one-chunk fixture cannot detect the original failure: the semantic
    // snapshot insert succeeded for chunk 0, then ON CONFLICT DO NOTHING
    // returned no id for chunks 1..N and silently skipped every later vector.
    const p = await paper('PUBLIC', [
      `first ${tag} introduction and abstract`,
      `second ${tag} literature review`,
      `third ${tag} methodology and findings`,
      `fourth ${tag} conclusion and recommendations`,
    ])
    const provider = stubGemini()

    const first = await embedAll(p.recordId)
    expect(first.embedded).toBe(4)
    expect(provider.calls).toBe(1)
    expect(provider.inputs).toBe(4)
    let counts = await testDb().execute(sql`
      select
        (select count(*)::int from document_chunks
          where index_id = ${p.keywordIndexId}) as chunks,
        (select count(*)::int from document_embeddings e
          join semantic_indexes si on si.id = e.semantic_index_id
          where si.keyword_index_id = ${p.keywordIndexId}) as vectors
    `)
    expect(counts.rows[0]).toMatchObject({ chunks: 4, vectors: 4 })

    // Arrange the exact production failure state without deleting the existing
    // chunk-0 vector: one vector exists under the snapshot, three are missing.
    await testDb().execute(sql`
      delete from document_embeddings
      where chunk_id in (
        select id from document_chunks
        where index_id = ${p.keywordIndexId} and ordinal > 0
      )
    `)
    const repaired = await embedAll(p.recordId)
    expect(repaired.embedded).toBe(3)
    expect(provider.calls).toBe(2)
    expect(provider.inputs).toBe(7)
    counts = await testDb().execute(sql`
      select
        (select count(*)::int from document_chunks
          where index_id = ${p.keywordIndexId}) as chunks,
        (select count(*)::int from document_embeddings e
          join semantic_indexes si on si.id = e.semantic_index_id
          where si.keyword_index_id = ${p.keywordIndexId}) as vectors
    `)
    expect(counts.rows[0]).toMatchObject({ chunks: 4, vectors: 4 })

    const complete = await embedAll(p.recordId)
    expect(complete.embedded).toBe(0)
    // No candidates means no paid provider call.
    expect(provider.calls).toBe(2)
  })

  dbIt('uses one provider request for 20 chunks and resumes the remainder', async () => {
    await testDb().execute(sql`delete from embedding_usage`)
    const p = await paper(
      'PUBLIC',
      Array.from(
        { length: 21 },
        (_, ordinal) => `batch ${ordinal} ${tag} bounded provider request`,
      ),
    )
    const provider = stubGemini()

    const first = await embedAll(p.recordId)
    expect(first).toMatchObject({ embedded: 20, papers: 1, hasMore: true })
    expect(provider.calls).toBe(1)
    expect(provider.inputs).toBe(20)

    const second = await embedAll(p.recordId)
    expect(second).toMatchObject({ embedded: 1, papers: 1, hasMore: false })
    expect(provider.calls).toBe(2)
    expect(provider.inputs).toBe(21)

    const rows = await testDb().execute(sql`
      select count(*)::int as n from document_embeddings e
      join semantic_indexes si on si.id = e.semantic_index_id
      where si.keyword_index_id = ${p.keywordIndexId}
    `)
    expect(rows.rows[0].n).toBe(21)
  })

  dbIt('reports provider rate limiting distinctly and keeps existing vectors', async () => {
    const p = await paper('PUBLIC', `rate limited ${tag} preparation`)
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).includes(GEMINI_HOST)) {
          return new Response(
            JSON.stringify({ error: { code: 429, message: 'RESOURCE_EXHAUSTED' } }),
            { status: 429 },
          )
        }
        return realFetch(input, init)
      },
    )
    const res = await post('/api/search/semantic/prepare', manager, {
      recordId: p.recordId,
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as {
      error: string
      message: string
      embedded: number
    }
    expect(body.error).toBe('embedding_provider_rate_limited')
    expect(body.message).toMatch(/at least 30 seconds/)
    expect(body.embedded).toBe(0)
    const rows = await testDb().execute(sql`
      select count(*)::int as n from document_embeddings e
      join semantic_indexes si on si.id = e.semantic_index_id
      where si.keyword_index_id = ${p.keywordIndexId}
    `)
    expect(rows.rows[0].n).toBe(0)
  })

  dbIt('reports a provider failure as 502 rather than an opaque 500', async () => {
    await paper('PUBLIC', `upstream ${tag} failure during preparation`)
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).includes(GEMINI_HOST)) {
          return new Response('upstream unavailable', { status: 503 })
        }
        return realFetch(input, init)
      },
    )
    const res = await post('/api/search/semantic/prepare', manager, {})
    expect(res.status).toBe(502)
    const body = (await res.json()) as {
      error: string
      message: string
      embedded: number
    }
    expect(body.error).toBe('embedding_provider_failed')
    expect(body.message).toMatch(/Wait briefly and retry/)
    expect(body.embedded).toBe(0)
  })

  dbIt('stores vectors normalized at the approved width and model', async () => {
    const p = await paper('PUBLIC', `normalized ${tag} vector storage check`)
    expect((await embedAll(p.recordId)).embedded).toBe(1)
    const rows = await testDb().execute(sql`
      select si.model, si.dimensions, vector_dims(e.embedding) as dims,
        array_length(e.embedding::real[], 1) as stored
      from document_embeddings e
      join semantic_indexes si on si.id = e.semantic_index_id
      where si.keyword_index_id = ${p.keywordIndexId}
    `)
    const row = rows.rows[0] as {
      model: string
      dimensions: number
      dims: number
      stored: number
    }
    expect(row.model).toBe('gemini-embedding-001')
    expect(row.dimensions).toBe(EMBEDDING_DIMS)
    expect(row.dims).toBe(EMBEDDING_DIMS)
    expect(row.stored).toBe(EMBEDDING_DIMS)
  })

  dbIt('ranks the closest paper first and applies visibility to results', async () => {
    // Earlier preparation tests intentionally charge the shared development
    // bucket. Ranking needs provider calls of its own and is not a quota test.
    await testDb().execute(sql`delete from embedding_usage`)
    const target = `photovoltaic photovoltaic photovoltaic ${tag} conversion efficiency solar panel output`
    const distractor = `photovoltaic marine ${tag} coral reef biodiversity survey transect`
    const publicPaper = await paper('PUBLIC', target)
    const restricted = await paper('RESTRICTED', distractor)
    const uaOnly = await paper(
      'UA_ONLY',
      `photovoltaic laboratory ${tag} titration procedure buffer`,
    )
    // Preparation is bounded to 2 papers per call, so embed these explicitly
    // rather than relying on a bulk call picking them out of the backlog.
    for (const p of [publicPaper, restricted, uaOnly]) {
      expect((await embedAll(p.recordId)).embedded).toBe(1)
    }

    const anon = await get('/api/search/semantic?q=photovoltaic', null)
    expect(anon.status).toBe(200)
    const anonBody = (await anon.json()) as {
      items: { id: string; visibility: string; distance: number }[]
      semanticStatus: string
    }
    expect(anonBody.semanticStatus).toBe('ready')
    const anonIds = anonBody.items.map((i) => i.id)
    expect(anonIds).toContain(publicPaper.recordId)
    // Restricted and UA-only stay out of anonymous results.
    expect(anonIds).not.toContain(restricted.recordId)
    expect(anonIds).not.toContain(uaOnly.recordId)

    const uaRes = await get('/api/search/semantic?q=photovoltaic', author)
    const uaBody = (await uaRes.json()) as { items: { id: string }[] }
    const uaIds = uaBody.items.map((i) => i.id)
    expect(uaIds).toContain(publicPaper.recordId)
    expect(uaIds).toContain(uaOnly.recordId)
    expect(uaIds).not.toContain(restricted.recordId)

    const mgrRes = await get('/api/search/semantic?q=photovoltaic', manager)
    const mgrBody = (await mgrRes.json()) as {
      items: { id: string; distance: number }[]
    }
    const mgrIds = mgrBody.items.map((i) => i.id)
    expect(mgrIds).toContain(restricted.recordId)
    // Managers see all three, so ranking is directly comparable. Assert the
    // RELATIVE order rather than "first overall": papers from other tests share
    // the database, so an absolute rank would depend on unrelated fixtures.
    const rank = (id: string) => mgrIds.indexOf(id)
    const distanceOf = (id: string) =>
      Number(mgrBody.items.find((i) => i.id === id)?.distance)
    expect(rank(publicPaper.recordId)).toBeGreaterThanOrEqual(0)
    expect(rank(publicPaper.recordId)).toBeLessThan(rank(restricted.recordId))
    expect(rank(publicPaper.recordId)).toBeLessThan(rank(uaOnly.recordId))
    // The topic-matching paper must be genuinely closer, not merely earlier.
    expect(distanceOf(publicPaper.recordId)).toBeLessThan(
      distanceOf(restricted.recordId),
    )
    expect(distanceOf(publicPaper.recordId)).toBeLessThan(
      distanceOf(uaOnly.recordId),
    )
  })

  dbIt('applies the distance guardrail to controlled vector geometry', async () => {
    // Isolate the daily budget from earlier semantic tests; the quota itself is
    // tested separately below. This proves the SQL boundary and visibility
    // composition only. Synthetic unit vectors cannot validate whether 0.7
    // separates relevant from irrelevant Gemini results in a real corpus.
    await testDb().execute(sql`delete from embedding_usage`)
    const close = await paper('PUBLIC', `threshold-close ${tag}`)
    const boundary = await paper('PUBLIC', `threshold-boundary ${tag}`)
    const far = await paper('PUBLIC', `threshold-far ${tag}`)
    const restricted = await paper('RESTRICTED', `threshold-restricted ${tag}`)
    const provider = stubThresholdGemini()
    for (const p of [close, boundary, far, restricted]) {
      expect((await embedAll(p.recordId)).embedded).toBe(1)
    }

    const anon = await get('/api/search/semantic?q=threshold calibration', null)
    expect(anon.status).toBe(200)
    const anonBody = (await anon.json()) as {
      items: { id: string; distance: number }[]
      semanticStatus: string
    }
    expect(anonBody.semanticStatus).toBe('ready')
    const anonIds = anonBody.items.map((item) => item.id)
    expect(anonIds).toContain(close.recordId)
    // The boundary is inclusive: <= 0.7, not < 0.7.
    expect(anonIds).toContain(boundary.recordId)
    expect(anonIds).not.toContain(far.recordId)
    // Relevance never overrides visibility.
    expect(anonIds).not.toContain(restricted.recordId)
    const boundaryDistance = Number(
      anonBody.items.find((item) => item.id === boundary.recordId)?.distance,
    )
    expect(boundaryDistance).toBeCloseTo(MAX_SEMANTIC_DISTANCE, 5)

    const managerResult = await get(
      '/api/search/semantic?q=threshold calibration',
      manager,
    )
    const managerIds = (
      (await managerResult.json()) as { items: { id: string }[] }
    ).items.map((item) => item.id)
    expect(managerIds).toContain(restricted.recordId)
    expect(managerIds).not.toContain(far.recordId)

    const noMatch = await get(
      '/api/search/semantic?q=threshold-no-match',
      manager,
    )
    expect(noMatch.status).toBe(200)
    expect(await noMatch.json()).toMatchObject({
      items: [],
      semanticStatus: 'ready',
    })
    expect(provider.calls).toBe(7) // 4 document batches + 3 query calls
  })

  dbIt('orders results by ascending distance rather than by id', async () => {
    await testDb().execute(sql`delete from embedding_usage`)
    // Guards the ORDER BY itself. The visibility test above can pass on a
    // single eligible row regardless of ordering, so rank several here.
    for (const label of ['one', 'two', 'three']) {
      const p = await paper('PUBLIC', `alphabet ${tag} ordering document ${label}`)
      expect((await embedAll(p.recordId)).embedded).toBe(1)
    }
    const res = await get('/api/search/semantic?q=alphabet', null)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { distance: number }[] }
    const distances = body.items.map((i) => Number(i.distance))
    expect(distances.length).toBeGreaterThan(1)
    // Cosine distance is in [0, 2]; a signed or missing value would sort oddly.
    for (const d of distances) expect(d).toBeGreaterThanOrEqual(0)
    const sorted = [...distances].sort((a, b) => a - b)
    expect(distances).toEqual(sorted)
  })

  dbIt('supports the opt-in record-level hybrid path', async () => {
    await testDb().execute(sql`delete from embedding_usage`)
    const p = await paper('PUBLIC', `hybrid keyword candidate ${tag}`)
    expect((await embedAll(p.recordId)).embedded).toBe(1)

    const res = await get('/api/search/semantic?q=hybrid%20keyword', manager, {
      SEMANTIC_SEARCH_MODE: 'hybrid',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: { id: string }[]
      semanticStatus: string
      retrievalMode: string
    }
    expect(body.semanticStatus).toBe('ready')
    expect(body.retrievalMode).toBe('hybrid')
    expect(new Set(body.items.map((item) => item.id)).size).toBe(body.items.length)
  })

  dbIt('scores one paper from its strongest three chunks', async () => {
    await testDb().execute(sql`delete from embedding_usage`)
    stubThresholdGemini()
    const paperWithOneLuckyChunk = await paper('PUBLIC', [
      `threshold-close ${tag}`,
      `threshold-far ${tag}`,
      `threshold-far ${tag}`,
    ])
    expect((await embedAll(paperWithOneLuckyChunk.recordId)).embedded).toBe(3)

    const res = await get('/api/search/semantic?q=threshold calibration', manager)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: { id: string; distance: number }[]
      semanticStatus: string
    }
    expect(body.semanticStatus).toBe('ready')
    const matches = body.items.filter((item) => item.id === paperWithOneLuckyChunk.recordId)
    expect(matches).toHaveLength(1)
    // One close chunk plus two far chunks must score as (0 + 1 + 1) / 3,
    // rather than inheriting MIN's lucky zero.
    expect(Number(matches[0].distance)).toBeCloseTo(2 / 3, 5)
  })

  dbIt('serves anonymous results cacheably and signed-in results privately', async () => {
    const p = await paper('PUBLIC', `cache ${tag} header semantics`)
    expect((await embedAll(p.recordId)).embedded).toBe(1)
    const anon = await get('/api/search/semantic?q=cache', null)
    expect(anon.headers.get('cache-control')).toContain('public')
    const signedIn = await get('/api/search/semantic?q=cache', author)
    expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
  })

  dbIt('degrades to keyword instead of failing when the provider errors', async () => {
    const p = await paper('PUBLIC', `provider ${tag} failure fallback check`)
    expect((await embedAll(p.recordId)).embedded).toBe(1)
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes(GEMINI_HOST)) {
        return new Response('upstream unavailable', { status: 503 })
      }
      return realFetch(input, init)
    })
    const res = await get('/api/search/semantic?q=provider', null)
    // Fail closed to keyword: a 200 the client can still render, not a 5xx.
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; semanticStatus: string }
    expect(body.semanticStatus).toBe('provider_error')
    expect(body.items).toEqual([])
  })

  dbIt('enforces the daily cap server-side and never calls the provider past it', async () => {
    const db = testDb()
    await db.execute(sql`delete from embedding_usage`)
    const before = await get('/api/search/semantic?q=quota probe', null)
    expect(before.status).toBe(200)
    const usage = await db.execute(
      sql`select bucket, requests, inputs from embedding_usage order by bucket`,
    )
    // Both the dev safety cap and the anonymous pool were charged.
    const buckets = usage.rows as { bucket: string; requests: number }[]
    expect(buckets.map((b) => b.bucket)).toContain('dev_global')
    expect(buckets.map((b) => b.bucket)).toContain('anon_global')

    // Exhaust the dev cap directly, then confirm the next call is denied
    // without any provider traffic.
    await db.execute(sql`
      insert into embedding_usage (bucket, actor_key, day, requests, inputs)
      values ('dev_global', 'all', current_date, 20, 2000)
      on conflict (bucket, actor_key, day) do update
        set requests = 20, inputs = 2000
    `)
    const calls = stubGemini()
    const denied = await get('/api/search/semantic?q=quota probe again', null)
    expect(denied.status).toBe(200)
    const body = (await denied.json()) as { semanticStatus: string; reason: string }
    expect(body.semanticStatus).toBe('quota_exhausted')
    expect(body.reason).toMatch(/limit reached/)
    // The whole point: a denied request must not reach the paid API.
    expect(calls.calls).toBe(0)
  })

  dbIt('does not consume quota for an empty query', async () => {
    const db = testDb()
    await db.execute(sql`delete from embedding_usage`)
    const res = await get('/api/search/semantic?q=', null)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { semanticStatus: string }).semanticStatus).toBe(
      'empty_query',
    )
    const usage = await db.execute(
      sql`select count(*)::int as n from embedding_usage`,
    )
    expect(usage.rows[0].n).toBe(0)
  })
})
