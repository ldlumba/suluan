import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { Hono, type MiddlewareHandler } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@suluan/db/schema'
import type { AppContext } from '../src/app-context'
import { CHUNKER_VERSION } from '../src/chunking'
import { serviceEmbedRoutes } from '../src/embed_claims'
import { createDirectSubmissionAtomic } from '../src/writes'

const isolated = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../src/db', () => ({ createDb: () => isolated.db }))

describe('embedding result claim fence on in-memory PostgreSQL', () => {
  let pg: PGlite
  let app: Hono<AppContext>
  let token: string
  let chunkIds: string[]
  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector } })
    const dir = path.resolve(process.cwd(), '../../packages/db/drizzle')
    const journal = JSON.parse(
      await readFile(path.join(dir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] }
    for (const entry of journal.entries)
      await pg.exec(await readFile(path.join(dir, `${entry.tag}.sql`), 'utf8'))
    isolated.db = drizzle(pg, { schema })
    const actor = (
      await pg.query(
        "insert into profiles (firebase_uid, email, role) values ('embed-fence', 'embed-fence@ua.edu.ph', 'ADMIN') returning id",
      )
    ).rows[0] as { id: string }
    const catalog = (
      await pg.query(
        'select id, school_id from courses where active = true limit 1',
      )
    ).rows[0] as { id: string; school_id: string }
    const created = await createDirectSubmissionAtomic(isolated.db as never, {
      submitterId: actor.id,
      idempotencyKey: crypto.randomUUID(),
      title: 'Fence test',
      normalizedTitle: 'fence test',
      schoolId: catalog.school_id,
      courseId: catalog.id,
      r2Key: 'test',
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      submitterEmail: null,
      keywords: [],
      visibility: 'PUBLIC',
      embargoUntil: null,
    })
    const recordId = (
      await pg.query<{ id: string }>(
        'select id from research_records where submission_id=$1',
        [created.submissionId],
      )
    ).rows[0].id
    const source = 'a'.repeat(64)
    const indexId = (
      await pg.query<{ id: string }>(
        'insert into keyword_indexes (record_id, extraction_claim_token, chunker_version, source_sha256) values ($1,$2,$3,$4) returning id',
        [recordId, crypto.randomUUID(), CHUNKER_VERSION, source],
      )
    ).rows[0].id
    chunkIds = (
      await pg.query<{ id: string }>(
        "insert into document_chunks (index_id, ordinal, start_offset, end_offset, content) values ($1,0,0,3,'one'), ($1,1,3,6,'two') returning id",
        [indexId],
      )
    ).rows.map((r) => r.id)
    token = crypto.randomUUID()
    const payload = chunkIds.map((chunkId) => ({
      chunkId,
      keywordIndexId: indexId,
      recordId,
      sourceSha256: source,
    }))
    await pg.query(
      "insert into embedding_claims (claim_token, kind, inputs, payload, expires_at) values ($1,'prep',2,$2::jsonb,now()+interval '10 minutes')",
      [token, JSON.stringify(payload)],
    )
    const authorize: MiddlewareHandler<AppContext> = async (c, next) => {
      c.set('serviceIdentity', { email: 'test@example.invalid' } as never)
      await next()
    }
    app = new Hono<AppContext>()
    app.route('/embed', serviceEmbedRoutes(authorize))
  })
  afterAll(async () => {
    await pg?.close()
  })
  it('accepts the claim once and never writes duplicate vectors on replay', async () => {
    const values = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))
    const payload = {
      claimToken: token,
      vectors: chunkIds.map((chunkId) => ({ chunkId, values })),
    }
    const mismatch = await app.request(
      '/embed/result',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          vectors: payload.vectors.slice(0, 1),
        }),
      },
      { DATABASE_URL: 'unused' } as never,
    )
    expect(mismatch.status).toBe(409)
    expect(
      (
        await pg.query<{ n: number }>(
          'select count(*)::int as n from document_embeddings',
        )
      ).rows[0].n,
    ).toBe(0)
    const request = () =>
      app.request(
        '/embed/result',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { DATABASE_URL: 'unused' } as never,
      )
    const result = await request()
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ embedded: 2 })
    expect((await request()).status).toBe(409)
    expect(
      (
        await pg.query<{ n: number }>(
          'select count(*)::int as n from document_embeddings',
        )
      ).rows[0].n,
    ).toBe(2)
  })
})
