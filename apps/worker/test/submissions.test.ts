import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { outboxEvents, submissionFiles, submissions } from '@suluan/db/schema'
import {
  deleteAuditEvents,
  deleteProfiles,
  deleteSubmissions,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

/**
 * Upload-then-finalize flow. All tests need the database (requireAuth
 * loads the profile), so the whole file skips without DATABASE_URL.
 */

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('submission intake', () => {
  let t: TestAuth
  const uids: string[] = []
  const submissionIds: string[] = []

  beforeAll(async () => {
    t = await setupTestAuth()
  })

  afterAll(async () => {
    const db = testDb()
    await deleteSubmissions(db, submissionIds)
    await deleteAuditEvents(db, submissionIds, uids)
    await deleteProfiles(db, uids)
  })

  async function userToken(uid: string, email: string) {
    uids.push(uid)
    return t.mintToken({ sub: uid, email })
  }

  async function initiate(token: string, body: unknown) {
    return t.app.request(
      '/api/uploads/initiate',
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

  async function finalize(token: string, body: unknown) {
    return t.app.request(
      '/api/submissions',
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

  function submissionBody(
    key: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      key,
      fileName: 'paper.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      idempotencyKey: crypto.randomUUID(),
      title: 'Test submission',
      ...overrides,
    }
  }

  it('rejects unsupported file types at initiation', async () => {
    const token = await userToken('uid-mime', 'mime@ua.edu.ph')
    const res = await initiate(token, {
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 100,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unsupported_file_type' })
  })

  it('rejects oversized uploads with the configured limit', async () => {
    const token = await userToken('uid-big', 'big@ua.edu.ph')
    const res = await initiate(token, {
      fileName: 'huge.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 31 * 1024 * 1024,
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: 'file_too_large',
      maxSizeBytes: 30 * 1024 * 1024,
    })
  })

  it('issues server-owned keys and neutralizes path traversal', async () => {
    const token = await userToken('uid-key', 'key@ua.edu.ph')
    const res = await initiate(token, {
      fileName: '../../etc/passwd.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { key: string; uploadUrl: string }
    expect(body.key.startsWith('intake/')).toBe(true)
    expect(body.key).not.toContain('..')
    expect(body.uploadUrl).toContain('put')
  })

  it('refuses to finalize an upload that never happened', async () => {
    const token = await userToken('uid-ghost', 'ghost@ua.edu.ph')
    const res = await finalize(
      token,
      submissionBody('intake/ghost-key/paper.pdf'),
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'upload_not_found' })
  })

  it('refuses size mismatches between claim and stored object', async () => {
    const token = await userToken('uid-mismatch', 'mismatch@ua.edu.ph')
    const init = (await (
      await initiate(token, {
        fileName: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      })
    ).json()) as { key: string }
    t.putObject(init.key, 2048)
    const res = await finalize(
      token,
      submissionBody(init.key, { sizeBytes: 1024 }),
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'upload_size_mismatch' })
  })

  it('rejects client-supplied keys outside the intake prefix', async () => {
    const token = await userToken('uid-evilkey', 'evilkey@ua.edu.ph')
    const res = await finalize(token, submissionBody('other-bucket/secret.pdf'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_file_key' })
  })

  it('creates a PENDING submission with file, audit, outbox, and queue message', async () => {
    const token = await userToken('uid-happy', 'happy@ua.edu.ph')
    const init = (await (
      await initiate(token, {
        fileName: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      })
    ).json()) as { key: string }
    t.putObject(init.key, 1024)

    const before = t.sentMessages.length
    const res = await finalize(token, submissionBody(init.key))
    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string; status: string }
    expect(created.status).toBe('PENDING')
    submissionIds.push(created.id)

    const db = testDb()
    const files = await db
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, created.id))
    expect(files).toHaveLength(1)
    expect(files[0].r2Key).toBe(init.key)

    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, created.id))
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('submission.created')

    expect(t.sentMessages.length).toBe(before + 1)
    expect(t.sentMessages[before]).toMatchObject({
      outboxId: events[0].id,
    })
  })

  it('replays idempotent finalizations without duplicating', async () => {
    const token = await userToken('uid-replay', 'replay@ua.edu.ph')
    const init = (await (
      await initiate(token, {
        fileName: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      })
    ).json()) as { key: string }
    t.putObject(init.key, 100)
    const idempotencyKey = crypto.randomUUID()

    const first = await finalize(
      token,
      submissionBody(init.key, { idempotencyKey, sizeBytes: 100 }),
    )
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { id: string }
    submissionIds.push(firstBody.id)

    const second = await finalize(
      token,
      submissionBody(init.key, { idempotencyKey, sizeBytes: 100 }),
    )
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { id: string }
    expect(secondBody.id).toBe(firstBody.id)

    const db = testDb()
    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.idempotencyKey, idempotencyKey))
    expect(rows).toHaveLength(1)
  })

  it('rejects unknown schools and mismatched course/school pairs', async () => {
    const token = await userToken('uid-catalog', 'catalog@ua.edu.ph')
    const init = (await (
      await initiate(token, {
        fileName: 'paper.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 50,
      })
    ).json()) as { key: string }
    t.putObject(init.key, 50)

    const unknown = await finalize(
      token,
      submissionBody(init.key, {
        sizeBytes: 50,
        schoolId: '00000000-0000-0000-0000-000000000000',
      }),
    )
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toMatchObject({ error: 'unknown_school' })
  })
})
