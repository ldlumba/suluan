import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { Hono, type MiddlewareHandler } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@suluan/db/schema'
import type { AppContext } from '../src/app-context'
import { recordAccessRoutes } from '../src/record-access'
import { createDirectSubmissionAtomic } from '../src/writes'

const isolated = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../src/db', () => ({ createDb: () => isolated.db }))

describe('accepted record keyword editing on in-memory PostgreSQL', () => {
  let pg: PGlite
  let app: Hono<AppContext>
  let recordId: string
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
        "insert into profiles (firebase_uid, email, role) values ('keyword-manager', 'keyword-manager@ua.edu.ph', 'REPOSITORY_MANAGER') returning id",
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
      title: 'Keyword test',
      normalizedTitle: 'keyword test',
      schoolId: catalog.school_id,
      courseId: catalog.id,
      r2Key: 'test',
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
      submitterEmail: null,
      keywords: [
        { term: 'Old', normalized: 'old' },
        { term: 'Keep', normalized: 'keep' },
      ],
      visibility: 'RESTRICTED',
      embargoUntil: null,
    })
    recordId = (
      (
        await pg.query(
          'select id from research_records where submission_id=$1',
          [created.submissionId],
        )
      ).rows[0] as { id: string }
    ).id
    const auth: MiddlewareHandler<AppContext> = async (c, next) => {
      c.set('profile', { id: actor.id, role: 'ADMIN' } as never)
      await next()
    }
    app = new Hono<AppContext>()
    app.route(
      '/access',
      recordAccessRoutes(auth, async (_c, next) => next()),
    )
  })
  afterAll(async () => {
    await pg?.close()
  })
  it('updates existing terms atomically, keeps submission keywords and rejects stale retries', async () => {
    const env = { DATABASE_URL: 'unused' } as never
    const listing = (await (await app.request('/access', {}, env)).json()) as {
      items: { id: string; updatedAt: string }[]
    }
    const version = listing.items.find((r) => r.id === recordId)!.updatedAt
    const patch = (keywords: string[], expectedUpdatedAt: string) =>
      app.request(
        `/access/${recordId}/keywords`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ keywords, expectedUpdatedAt }),
        },
        env,
      )
    expect((await patch(['Keep', 'New'], version)).status).toBe(200)
    expect((await patch(['Wrong'], version)).status).toBe(409)
    const words = await pg.query<{ display_name: string }>(
      'select k.display_name from research_keywords rk join keywords k on k.id=rk.keyword_id where rk.record_id=$1 order by rk.position',
      [recordId],
    )
    expect(words.rows.map((r) => r.display_name)).toEqual(['Keep', 'New'])
    const originals = await pg.query<{ term: string }>(
      'select term from submission_keywords order by position',
    )
    expect(originals.rows.map((r) => r.term)).toEqual(['Old', 'Keep'])
    const audits = await pg.query<{ n: number }>(
      "select count(*)::int as n from audit_events where action='record.keywords_changed'",
    )
    expect(audits.rows[0].n).toBe(1)
    const currentListing = (await (
      await app.request('/access', {}, env)
    ).json()) as { items: { id: string; updatedAt: string }[] }
    const currentVersion = currentListing.items.find(
      (r) => r.id === recordId,
    )!.updatedAt
    expect((await patch([], currentVersion)).status).toBe(200)
    expect(
      (
        await pg.query('select id from research_keywords where record_id=$1', [
          recordId,
        ])
      ).rows,
    ).toHaveLength(0)
  })
  it('does not expose or modify retained abstract data through retired routes', async () => {
    const env = { DATABASE_URL: 'unused' } as never
    await pg.query(
      'update research_records set abstract=$2, abstract_approved_at=now() where id=$1',
      [recordId, 'Previously approved abstract'],
    )
    expect(
      (await app.request(`/access/${recordId}/abstract`, {}, env)).status,
    ).toBe(404)
    expect(
      (
        await app.request(
          `/access/${recordId}/abstract`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          },
          env,
        )
      ).status,
    ).toBe(404)
    const record = (
      await pg.query<{ abstract: string }>(
        'select abstract from research_records where id=$1',
        [recordId],
      )
    ).rows[0]
    expect(record.abstract).toBe('Previously approved abstract')
  })
})
