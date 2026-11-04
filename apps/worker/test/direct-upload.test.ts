import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createDirectSubmissionAtomic } from '../src/writes'
import { setupTestAuth, type TestAuth } from './helpers'

const db = vi.hoisted(() => ({
  execute: vi.fn(),
  query: { profiles: { findFirst: vi.fn() } },
}))
vi.mock('../src/db', () => ({ createDb: () => db }))

describe('direct upload', () => {
  let auth: TestAuth
  beforeAll(async () => {
    auth = await setupTestAuth()
  })
  it('rejects non-manager accounts before reading the upload', async () => {
    db.query.profiles.findFirst.mockResolvedValue({
      id: 'user',
      role: 'USER',
      email: 'user@ua.edu.ph',
    })
    const token = await auth.mintToken({ sub: 'user', email: 'user@ua.edu.ph' })
    const response = await auth.app.request(
      '/api/submissions/direct',
      { method: 'POST', headers: { authorization: `Bearer ${token}` } },
      auth.testEnv(),
    )
    expect(response.status).toBe(403)
    expect(db.execute).not.toHaveBeenCalled()
  })
  it.each(['ADMIN', 'REPOSITORY_MANAGER'] as const)(
    'lets %s reach upload validation',
    async (role) => {
      db.query.profiles.findFirst.mockResolvedValue({
        id: 'manager',
        role,
        email: 'manager@ua.edu.ph',
      })
      const token = await auth.mintToken({
        sub: 'manager',
        email: 'manager@ua.edu.ph',
      })
      const response = await auth.app.request(
        '/api/submissions/direct',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: '',
        },
        auth.testEnv(),
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'missing_file' })
    },
  )
  it('constructs a single acceptance statement without an email outbox', async () => {
    db.execute.mockResolvedValue({ rows: [{ submissionId: 'id' }] })
    const result = await createDirectSubmissionAtomic(db as never, {
      submitterId: 'actor',
      idempotencyKey: 'key',
      title: 'Paper',
      normalizedTitle: 'paper',
      schoolId: 'school',
      courseId: 'program',
      r2Key: 'key',
      fileName: 'paper.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      submitterEmail: null,
      keywords: [],
      visibility: 'RESTRICTED',
      embargoUntil: null,
    })
    expect(result).toEqual({ submissionId: 'id', outboxId: null })
    const query = new PgDialect().sqlToQuery(
      db.execute.mock.calls.at(-1)![0],
    ).sql
    expect(query).toContain("'ACCEPTED'")
    expect(query).toContain('insert into decisions')
    expect(query).toContain('insert into processing_jobs')
    expect(query).toContain('submission.direct_accepted')
    expect(query).not.toContain('insert into outbox_events')
  })
})
