import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@suluan/db/schema'
import { CHUNKER_VERSION } from '../src/chunking'
import { createDirectSubmissionAtomic } from '../src/writes'
import { insertProfile, setupTestAuth, testDb, type TestAuth } from './helpers'

const isolated = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../src/db', () => ({ createDb: () => isolated.db }))

describe('withdrawal lifecycle on in-memory PostgreSQL', () => {
  let pg: PGlite
  let t: TestAuth
  let manager: string
  let user: string
  let service: string
  let recordId: string
  let jobId: string
  let processingToken: string
  let embedToken: string
  let chunkId: string
  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector } })
    const dir = path.resolve(process.cwd(), '../../packages/db/drizzle')
    const journal = JSON.parse(
      await readFile(path.join(dir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] }
    for (const entry of journal.entries)
      await pg.exec(await readFile(path.join(dir, `${entry.tag}.sql`), 'utf8'))
    isolated.db = drizzle(pg, { schema })
    t = await setupTestAuth()
    const actor = await insertProfile(
      testDb(),
      'withdraw-manager',
      'withdraw-manager@ua.edu.ph',
      'REPOSITORY_MANAGER',
    )
    await insertProfile(
      testDb(),
      'withdraw-user',
      'withdraw-user@ua.edu.ph',
      'USER',
    )
    manager = await t.mintToken({
      sub: 'withdraw-manager',
      email: 'withdraw-manager@ua.edu.ph',
    })
    user = await t.mintToken({
      sub: 'withdraw-user',
      email: 'withdraw-user@ua.edu.ph',
    })
    service = await t.mintServiceToken()
    const catalog = (
      await pg.query<{ id: string; school_id: string }>(
        'select id, school_id from courses where active=true limit 1',
      )
    ).rows[0]
    const created = await createDirectSubmissionAtomic(testDb(), {
      submitterId: actor.id,
      idempotencyKey: crypto.randomUUID(),
      title: 'Withdrawal safety fixture',
      normalizedTitle: 'withdrawal safety fixture',
      schoolId: catalog.school_id,
      courseId: catalog.id,
      r2Key: 'fixture',
      fileName: 'fixture.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      submitterEmail: null,
      keywords: [{ term: 'safety', normalized: 'safety' }],
      visibility: 'PUBLIC',
      embargoUntil: null,
    })
    recordId = (
      await pg.query<{ id: string }>(
        'select id from research_records where submission_id=$1',
        [created.submissionId],
      )
    ).rows[0].id
    const processingClaim = await t.app.request(
      '/api/internal/processing/claim',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${service}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
      t.testEnv(),
    )
    expect(processingClaim.status).toBe(200)
    const processing = (await processingClaim.json()) as {
      jobId: string
      claimToken: string
    }
    jobId = processing.jobId
    processingToken = processing.claimToken
    const source = 'a'.repeat(64)
    const indexId = (
      await pg.query<{ id: string }>(
        'insert into keyword_indexes (record_id, extraction_claim_token, chunker_version, source_sha256) values ($1,$2,$3,$4) returning id',
        [recordId, processingToken, CHUNKER_VERSION, source],
      )
    ).rows[0].id
    chunkId = (
      await pg.query<{ id: string }>(
        "insert into document_chunks (index_id, ordinal, start_offset, end_offset, content) values ($1,0,0,4,'test') returning id",
        [indexId],
      )
    ).rows[0].id
    const claim = await t.app.request(
      '/api/internal/embeddings/claim',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${service}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ recordId }),
      },
      t.testEnv(),
    )
    expect(claim.status).toBe(200)
    const claimBody = (await claim.json()) as {
      claimToken: string
      items: { chunkId: string; lifecycleVersion: number }[]
    }
    expect(claimBody.items).toMatchObject([{ chunkId, lifecycleVersion: 0 }])
    embedToken = claimBody.claimToken
  })
  afterAll(async () => {
    await pg?.close()
  })
  const get = (url: string, token?: string) =>
    t.app.request(
      url,
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
      t.testEnv(),
    )
  const patch = (body: unknown, token = manager) =>
    t.app.request(
      `/api/record-access/${recordId}/lifecycle`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      t.testEnv(),
    )
  it('withdraws without deletion or email, hides discovery, and fences old work even after reinstatement', async () => {
    await pg.query('update research_records set abstract=$2 where id=$1', [
      recordId,
      'Unapproved legacy abstract',
    ])
    const beforeApproval = (await (
      await get(`/api/records/${recordId}`)
    ).json()) as { abstract: string | null }
    expect(beforeApproval.abstract).toBeNull()
    const searchBefore = (await (
      await get('/api/search/records?q=withdrawal')
    ).json()) as { items: { id: string; abstractPreview: string | null }[] }
    expect(
      searchBefore.items.find((item) => item.id === recordId)?.abstractPreview,
    ).toBeNull()
    const review = (await (
      await get(`/api/record-access/${recordId}/abstract`, manager)
    ).json()) as { updatedAt: string }
    const approvalBody = {
      abstract: 'Approved abstract',
      expectedUpdatedAt: review.updatedAt,
    }
    const approve = (token: string) =>
      t.app.request(
        `/api/record-access/${recordId}/abstract`,
        {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(approvalBody),
        },
        t.testEnv(),
      )
    expect((await approve(user)).status).toBe(403)
    expect((await approve(manager)).status).toBe(200)
    expect(
      (
        (await (await get(`/api/records/${recordId}`)).json()) as {
          abstract: string
        }
      ).abstract,
    ).toBe('Approved abstract')
    const searchAfter = (await (
      await get('/api/search/records?q=withdrawal')
    ).json()) as { items: { id: string; abstractPreview: string | null }[] }
    expect(
      searchAfter.items.find((item) => item.id === recordId)?.abstractPreview,
    ).toBe('Approved abstract')
    expect((await get(`/api/records/${recordId}`)).status).toBe(200)
    const active = (await (
      await get('/api/record-access', manager)
    ).json()) as { items: { id: string; updatedAt: string }[] }
    const version = active.items.find((r) => r.id === recordId)!.updatedAt
    const withdraw = {
      action: 'withdraw',
      reason: 'Accidental acceptance',
      expectedUpdatedAt: version,
    }
    expect((await patch(withdraw, user)).status).toBe(403)
    expect((await patch(withdraw)).status).toBe(200)
    expect((await patch(withdraw)).status).toBe(409)
    expect((await get(`/api/records/${recordId}`)).status).toBe(404)
    expect((await get(`/api/records/${recordId}`, manager)).status).toBe(404)
    expect(
      (await get(`/api/record-access/${recordId}/abstract`, manager)).status,
    ).toBe(404)
    expect(
      (await get(`/api/records/${recordId}/download`, manager)).status,
    ).toBe(404)
    expect((await get(`/api/graph/neighborhood?id=${recordId}`)).status).toBe(
      404,
    )
    const search = (await (
      await get('/api/search/records?q=withdrawal')
    ).json()) as { items: { id: string }[] }
    expect(search.items.some((r) => r.id === recordId)).toBe(false)
    const suggestions = (await (
      await get('/api/search/suggestions?q=withdrawal')
    ).json()) as { items: { id: string }[] }
    expect(suggestions.items.some((r) => r.id === recordId)).toBe(false)
    expect(
      (
        await pg.query<{ n: number }>(
          'select count(*)::int as n from research_records where id=$1 and withdrawn_at is not null',
          [recordId],
        )
      ).rows[0].n,
    ).toBe(1)
    const canceled = (
      await pg.query<{ status: string; claim_token: string | null }>(
        'select status, claim_token from processing_jobs where id=$1',
        [jobId],
      )
    ).rows[0]
    expect(canceled).toMatchObject({ status: 'QUEUED', claim_token: null })
    expect(
      (
        await pg.query<{ n: number }>(
          'select count(*)::int as n from outbox_events',
        )
      ).rows[0].n,
    ).toBe(0)
    const withdrawn = (await (
      await get('/api/record-access?state=withdrawn', manager)
    ).json()) as { items: { id: string; updatedAt: string }[] }
    // Model a claim missed by withdrawal's statement snapshot; reinstatement
    // must invalidate it before making the record active again.
    await pg.query(
      "update processing_jobs set status='PROCESSING', claim_token=$2, lease_until=now()+interval '10 minutes' where id=$1",
      [jobId, processingToken],
    )
    expect(
      (
        await patch({
          action: 'reinstate',
          reason: 'Corrected',
          expectedUpdatedAt: withdrawn.items.find((r) => r.id === recordId)!
            .updatedAt,
          visibility: 'RESTRICTED',
          embargoUntil: null,
        })
      ).status,
    ).toBe(200)
    expect((await get(`/api/records/${recordId}`)).status).toBe(404)
    expect((await get(`/api/records/${recordId}`, manager)).status).toBe(200)
    const stale = await t.app.request(
      `/api/internal/processing/${jobId}/result`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${service}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          claimToken: processingToken,
          status: 'FAILED',
          errorCode: 'PROCESSOR_FAILED',
        }),
      },
      t.testEnv(),
    )
    expect(stale.status).toBe(409)
    // Simulate a reservation inserted by a racing worker after withdrawal's
    // snapshot; the record generation must still fence this old claim.
    await pg.query(
      'update embedding_claims set used_at=null where claim_token=$1',
      [embedToken],
    )
    const oldEmbed = await t.app.request(
      '/api/internal/embeddings/result',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${service}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          claimToken: embedToken,
          vectors: [
            {
              chunkId,
              values: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)),
            },
          ],
        }),
      },
      t.testEnv(),
    )
    expect(oldEmbed.status).toBe(409)
    expect(
      (
        await pg.query<{ n: number }>(
          'select count(*)::int as n from document_embeddings',
        )
      ).rows[0].n,
    ).toBe(0)
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int as n from audit_events where action in ('record.withdrawn','record.reinstated')",
        )
      ).rows[0].n,
    ).toBe(2)
  })
})
