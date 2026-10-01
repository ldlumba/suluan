import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  decisions,
  notifications,
  outboxEvents,
  researchRecords,
  recordFiles,
  submissionFiles,
  submissions,
} from '@suluan/db/schema'
import { logEmailAdapter } from '../src/email'
import { processOutboxEvent } from '../src/notifications'
import {
  deleteAuditEvents,
  deleteProfiles,
  deleteSubmissions,
  deleteSubmissionsForProfiles,
  insertProfile,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

/**
 * Review workflow: queue visibility, remarks enforcement, single-decision
 * rule, accept/reject branching, manager-only downloads, and outbox
 * dispatch. Database-gated like the other route suites.
 */

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('review workflow', () => {
  let t: TestAuth
  const uids: string[] = []
  const submissionIds: string[] = []
  let userToken = ''
  let managerToken = ''

  beforeAll(async () => {
    t = await setupTestAuth()
    const db = testDb()
    // Fixed test identities: clear leftovers from interrupted runs first.
    await deleteSubmissionsForProfiles(db, ['uid-reviewer', 'uid-author'])
    await deleteProfiles(db, ['uid-reviewer', 'uid-author'])
    await insertProfile(
      db,
      'uid-reviewer',
      'reviewer@ua.edu.ph',
      'REPOSITORY_MANAGER',
    )
    uids.push('uid-reviewer', 'uid-author')
    userToken = await t.mintToken({
      sub: 'uid-author',
      email: 'author@ua.edu.ph',
    })
    managerToken = await t.mintToken({
      sub: 'uid-reviewer',
      email: 'reviewer@ua.edu.ph',
    })
  })

  afterAll(async () => {
    const db = testDb()
    await deleteSubmissions(db, submissionIds)
    await deleteAuditEvents(db, submissionIds, uids)
    await deleteProfiles(db, uids)
  })

  function post(path: string, token: string | null, body: unknown) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (token) headers.authorization = `Bearer ${token}`
    return t.app.request(
      path,
      { method: 'POST', headers, body: JSON.stringify(body) },
      t.testEnv(),
    )
  }

  function get(path: string, token: string | null) {
    const headers: Record<string, string> = {}
    if (token) headers.authorization = `Bearer ${token}`
    return t.app.request(path, { headers }, t.testEnv())
  }

  async function submit(title: string): Promise<{ id: string; key: string }> {
    const file = new File(['x'.repeat(777)], 'paper.pdf', {
      type: 'application/pdf',
    })
    const form = new FormData()
    form.append('file', file)
    form.append('idempotencyKey', crypto.randomUUID())
    form.append('title', title)
    const res = await t.app.request(
      '/api/submissions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${userToken}` },
        body: form,
      },
      t.testEnv(),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    submissionIds.push(body.id)
    const db = testDb()
    const files = await db
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, body.id))
    expect(files).toHaveLength(1)
    return { id: body.id, key: files[0].r2Key }
  }

  it('hides the review queue from ordinary users', async () => {
    expect((await get('/api/review/queue', userToken)).status).toBe(403)
  })

  it('lists pending submissions for managers', async () => {
    const { id } = await submit('Awaiting review')
    const res = await get('/api/review/queue', managerToken)
    expect(res.status).toBe(200)
    const queue = (await res.json()) as { id: string; submitterEmail: string }[]
    const found = queue.find((s) => s.id === id)
    expect(found?.submitterEmail).toBe('author@ua.edu.ph')
  })

  it('requires remarks before a decision', async () => {
    const { id } = await submit('Needs remarks')
    const res = await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'ACCEPTED',
      remarks: '   ',
    })
    expect(res.status).toBe(400)
  })

  it('accepts: flips status, records decision, links the same R2 object', async () => {
    const { id, key } = await submit('Accept me')
    const res = await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'ACCEPTED',
      remarks: 'Solid methodology, publish it.',
    })
    expect(res.status).toBe(201)

    const db = testDb()
    const [row] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, id))
    expect(row.status).toBe('ACCEPTED')

    const decisionRows = await db
      .select()
      .from(decisions)
      .where(eq(decisions.submissionId, id))
    expect(decisionRows).toHaveLength(1)
    expect(decisionRows[0].remarks).toContain('Solid methodology')

    const records = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, id))
    expect(records).toHaveLength(1)
    const files = await db
      .select()
      .from(recordFiles)
      .where(eq(recordFiles.recordId, records[0].id))
    expect(files).toHaveLength(1)
    // Same authoritative object — not a copy.
    expect(files[0].r2Key).toBe(key)
  })

  it('rejects second decisions on decided submissions', async () => {
    const { id } = await submit('Decide twice')
    const first = await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'REJECTED',
      remarks: 'Out of scope.',
    })
    expect(first.status).toBe(201)
    const second = await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'ACCEPTED',
      remarks: 'Changed my mind.',
    })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({
      error: 'already_decided',
      status: 'REJECTED',
    })
  })

  it('rejects without creating repository records', async () => {
    const { id } = await submit('Reject me')
    const res = await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'REJECTED',
      remarks: 'Duplicate submission.',
    })
    expect(res.status).toBe(201)
    const db = testDb()
    const records = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, id))
    expect(records).toHaveLength(0)
  })

  it('denies file downloads to submitters, streams title-named bytes to managers', async () => {
    const { id } = await submit('Download check')
    const denied = await get(`/api/submissions/${id}/download`, userToken)
    expect(denied.status).toBe(403)
    const allowed = await get(`/api/submissions/${id}/download`, managerToken)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('content-type')).toContain('application/pdf')
    const disposition = allowed.headers.get('content-disposition') ?? ''
    expect(disposition).toContain('attachment')
    // Named after the study, with the original extension — not the
    // submitter's local file name.
    expect(disposition).toContain('Download check.pdf')
    expect(disposition).toContain("filename*=UTF-8''Download%20check.pdf")
    const bytes = new Uint8Array(await allowed.arrayBuffer())
    expect(bytes.length).toBe(777)
  })

  it('dispatches outbox events once, then reports replays', async () => {
    const { id } = await submit('Notify me')
    const db = testDb()
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, id))
    // No REO mailbox configured in tests: must SKIP visibly, not vanish.
    const first = await processOutboxEvent(db, event.id, logEmailAdapter())
    expect(first).toBe('skipped')
    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.submissionId, id))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      kind: 'reo_new_submission',
      status: 'SKIPPED',
    })

    expect(await processOutboxEvent(db, event.id, logEmailAdapter())).toBe(
      'already-processed',
    )
  })

  it('sends decision notifications to the submitter address', async () => {
    const { id } = await submit('Decision mail')
    await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'ACCEPTED',
      remarks: 'Welcome aboard.',
    })
    const db = testDb()
    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, id))
    const decisionEvent = events.find((e) => e.eventType === 'decision.made')
    expect(decisionEvent).toBeDefined()
    const outcome = await processOutboxEvent(
      db,
      decisionEvent!.id,
      logEmailAdapter(),
    )
    expect(outcome).toBe('sent')
    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.submissionId, id))
    const mail = notes.find((n) => n.kind === 'submitter_decision')
    expect(mail).toMatchObject({
      status: 'SENT',
      recipientEmail: 'author@ua.edu.ph',
    })
  })
})
