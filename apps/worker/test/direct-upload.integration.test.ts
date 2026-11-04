import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@suluan/db/schema'
import {
  auditEvents,
  decisions,
  outboxEvents,
  processingJobs,
  researchRecords,
  submissions,
} from '@suluan/db/schema'
import {
  insertProfile,
  setupTestAuth,
  testCatalog,
  testDb,
  type TestAuth,
} from './helpers'

const isolated = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../src/db', () => ({ createDb: () => isolated.db }))

describe('direct upload on an in-memory PostgreSQL database', () => {
  let pg: PGlite
  let auth: TestAuth
  let token: string
  let catalog: { schoolId: string; courseId: string }
  const uid = `direct-test-${crypto.randomUUID()}`
  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector } })
    const dir = path.resolve(process.cwd(), '../../packages/db/drizzle')
    const journal = JSON.parse(
      await readFile(path.join(dir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] }
    for (const entry of journal.entries)
      await pg.exec(await readFile(path.join(dir, `${entry.tag}.sql`), 'utf8'))
    isolated.db = drizzle(pg, { schema })
    auth = await setupTestAuth()
    await insertProfile(testDb(), uid, `${uid}@ua.edu.ph`, 'REPOSITORY_MANAGER')
    token = await auth.mintToken({ sub: uid, email: `${uid}@ua.edu.ph` })
    catalog = await testCatalog()
  })
  afterAll(async () => {
    await pg?.close()
  })
  it('accepts once with a restricted record, processing job, audit and no email outbox', async () => {
    const form = new FormData()
    form.append(
      'file',
      new File(['paper'], 'paper.pdf', { type: 'application/pdf' }),
    )
    form.append('idempotencyKey', crypto.randomUUID())
    form.append('title', `Direct ${uid}`)
    form.append('schoolId', catalog.schoolId)
    form.append('courseId', catalog.courseId)
    form.append('visibility', 'RESTRICTED')
    const request = () =>
      auth.app.request(
        '/api/submissions/direct',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: form,
        },
        auth.testEnv(),
      )
    const response = await request()
    expect(response.status).toBe(201)
    const body = (await response.json()) as { id: string; status: string }
    expect(body.status).toBe('ACCEPTED')
    const db = testDb()
    expect(
      (
        await db.select().from(submissions).where(eq(submissions.id, body.id))
      )[0].status,
    ).toBe('ACCEPTED')
    expect(
      (
        await db
          .select()
          .from(decisions)
          .where(eq(decisions.submissionId, body.id))
      )[0].remarks,
    ).toBe('Directly accepted by repository manager')
    const records = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, body.id))
    expect(records).toHaveLength(1)
    expect(records[0].visibility).toBe('RESTRICTED')
    const anonymous = await auth.app.request(
      `/api/records/${records[0].id}`,
      {},
      auth.testEnv(),
    )
    expect(anonymous.status).toBe(404)
    expect(
      await db
        .select()
        .from(processingJobs)
        .where(eq(processingJobs.recordId, records[0].id)),
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, body.id)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, body.id)),
    ).toHaveLength(1)
    const replay = await request()
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({
      id: body.id,
      status: 'ACCEPTED',
    })
  })
  it('rejects a past auto-lift date before creating a record', async () => {
    const form = new FormData()
    form.append(
      'file',
      new File(['paper'], 'paper.pdf', { type: 'application/pdf' }),
    )
    form.append('idempotencyKey', crypto.randomUUID())
    form.append('title', `Bad date ${uid}`)
    form.append('schoolId', catalog.schoolId)
    form.append('courseId', catalog.courseId)
    form.append('visibility', 'RESTRICTED')
    form.append('embargoUntil', '2000-01-01')
    const response = await auth.app.request(
      '/api/submissions/direct',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      },
      auth.testEnv(),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_access' })
  })
})
