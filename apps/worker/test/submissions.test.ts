import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { outboxEvents, submissionFiles, submissions } from '@suluan/db/schema'
import {
  deleteAuditEvents,
  deleteProfiles,
  deleteSubmissions,
  deleteSubmissionsForProfiles,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

/**
 * Worker-proxied submission intake: the browser POSTs multipart/form-data
 * and the Worker streams the file into R2 before the atomic DB write.
 * All tests need the database (requireAuth loads the profile), so the
 * whole file skips without DATABASE_URL.
 */

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

function pdfFile(name = 'paper.pdf', size = 1024): File {
  return new File(['x'.repeat(size)], name, { type: 'application/pdf' })
}

needsDb('submission intake', () => {
  let t: TestAuth
  const uids: string[] = []
  const submissionIds: string[] = []

  beforeAll(async () => {
    t = await setupTestAuth()
  })

  afterAll(async () => {
    const db = testDb()
    // Belt-and-braces: delete by submitter uid too, so any submission a
    // failed assertion forgot to track still gets cleaned up.
    await deleteSubmissionsForProfiles(db, uids)
    await deleteSubmissions(db, submissionIds)
    await deleteAuditEvents(db, submissionIds, uids)
    await deleteProfiles(db, uids)
  })

  async function userToken(uid: string, email: string) {
    uids.push(uid)
    return t.mintToken({ sub: uid, email })
  }

  function formBody(
    file: File | null,
    fields: Record<string, string> = {},
  ): FormData {
    const form = new FormData()
    if (file) form.append('file', file)
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return form
  }

  async function submit(token: string, file: File | null, fields: Record<string, string> = {}) {
    return t.app.request(
      '/api/submissions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: formBody(file, {
          idempotencyKey: crypto.randomUUID(),
          title: 'Test submission',
          ...fields,
        }),
      },
      t.testEnv(),
    )
  }

  it('rejects requests with no file part', async () => {
    const token = await userToken('uid-nofile', 'nofile@ua.edu.ph')
    const res = await submit(token, null)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'missing_file' })
  })

  it('rejects unsupported file types', async () => {
    const token = await userToken('uid-mime', 'mime@ua.edu.ph')
    const txt = new File(['hi'], 'notes.txt', { type: 'text/plain' })
    const res = await submit(token, txt)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unsupported_file_type' })
  })

  it('rejects mismatched file names', async () => {
    const token = await userToken('uid-mismatch', 'mismatch@ua.edu.ph')
    const renamed = new File(['x'.repeat(100)], 'paper.pdf', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const res = await submit(token, renamed)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'filename_type_mismatch' })
  })

  it('rejects oversized uploads with the configured limit', async () => {
    const token = await userToken('uid-big', 'big@ua.edu.ph')
    const bytes = new Uint8Array(31 * 1024 * 1024)
    bytes.fill(120) // 'x'
    const big = new File([bytes], 'huge.pdf', { type: 'application/pdf' })
    const res = await submit(token, big)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: 'file_too_large',
      maxSizeBytes: 30 * 1024 * 1024,
    })
  })

  it('rejects empty files', async () => {
    const token = await userToken('uid-empty', 'empty@ua.edu.ph')
    const empty = new File([], 'paper.pdf', { type: 'application/pdf' })
    const res = await submit(token, empty)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'empty_file' })
  })

  it('creates a PENDING submission with R2 bytes, file, audit, outbox, and queue message', async () => {
    const token = await userToken('uid-happy', 'happy@ua.edu.ph')
    const before = t.sentMessages.length
    const res = await submit(token, pdfFile('paper.pdf', 1024))
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
    expect(files[0].r2Key.startsWith('intake/')).toBe(true)
    expect(files[0].r2Key).not.toContain('..')
    expect(files[0].sizeBytes).toBe(1024)

    // The Worker stored the actual bytes under its own key.
    const stored = t.r2objects.get(files[0].r2Key)
    expect(stored?.size).toBe(1024)
    expect(stored?.contentType).toBe('application/pdf')

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

  it('replays idempotent submissions without storing another object', async () => {
    const token = await userToken('uid-replay', 'replay@ua.edu.ph')
    const idempotencyKey = crypto.randomUUID()
    const objectsBefore = t.r2objects.size

    const first = await submit(token, pdfFile('paper.pdf', 100), {
      idempotencyKey,
    })
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { id: string }
    submissionIds.push(firstBody.id)
    expect(t.r2objects.size).toBe(objectsBefore + 1)

    const second = await submit(token, pdfFile('paper.pdf', 100), {
      idempotencyKey,
    })
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { id: string }
    expect(secondBody.id).toBe(firstBody.id)
    // Replay short-circuits before the R2 put: no second object.
    expect(t.r2objects.size).toBe(objectsBefore + 1)

    const db = testDb()
    const rows = await db
      .select()
      .from(submissions)
      .where(eq(submissions.idempotencyKey, idempotencyKey))
    expect(rows).toHaveLength(1)
  })

  it('rejects unknown schools without storing the file', async () => {
    const token = await userToken('uid-catalog', 'catalog@ua.edu.ph')
    const objectsBefore = t.r2objects.size
    const res = await submit(token, pdfFile('paper.pdf', 50), {
      schoolId: '00000000-0000-0000-0000-000000000000',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unknown_school' })
    expect(t.r2objects.size).toBe(objectsBefore)
  })
})
