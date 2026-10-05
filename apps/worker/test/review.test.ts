import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  decisions,
  auditEvents,
  notifications,
  outboxEvents,
  researchRecords,
  recordAuthors,
  recordFiles,
  submissionFiles,
  submissions,
  processingJobs,
  courses,
  schools,
} from '@suluan/db/schema'
import { logEmailAdapter, type EmailDraft } from '../src/email'
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  processOutboxEvent,
  sweepOutbox,
} from '../src/notifications'
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
  const systemAuditEntityIds: string[] = []
  let userToken = ''
  let managerToken = ''
  let serviceToken = ''

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
    serviceToken = await t.mintServiceToken()
  })

  afterAll(async () => {
    const db = testDb()
    await deleteAuditEvents(db, systemAuditEntityIds, [])
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

  async function submit(
    title: string,
    authors?: string,
    catalog?: { schoolId: string; courseId: string },
  ): Promise<{ id: string; key: string }> {
    const file = new File(['x'.repeat(777)], 'paper.pdf', {
      type: 'application/pdf',
    })
    const form = new FormData()
    form.append('file', file)
    form.append('idempotencyKey', crypto.randomUUID())
    form.append('title', title)
    if (authors) form.append('authors', authors)
    if (catalog) {
      form.append('schoolId', catalog.schoolId)
      form.append('courseId', catalog.courseId)
    }
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

  it('normalizes newline-delimited authors when a paper is accepted', async () => {
    const { id } = await submit(
      'Normalized repository authors',
      'Cruz, Lorenzo S.\nSecond Author',
    )
    expect(
      (
        await post('/api/decisions', managerToken, {
          submissionId: id,
          status: 'ACCEPTED',
          remarks: 'Approved',
        })
      ).status,
    ).toBe(201)
    const db = testDb()
    const [record] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, id))
    const authors = await db
      .select({ name: recordAuthors.name, position: recordAuthors.position })
      .from(recordAuthors)
      .where(eq(recordAuthors.recordId, record.id))
      .orderBy(recordAuthors.position)
    expect(authors).toEqual([
      { name: 'Cruz, Lorenzo S.', position: 0 },
      { name: 'Second Author', position: 1 },
    ])
  })

  it('restricts processing operations to managers', async () => {
    expect((await get('/api/processing/jobs', null)).status).toBe(401)
    expect((await get('/api/processing/jobs', userToken)).status).toBe(403)
    for (const action of ['claim', 'result', 'retry']) {
      expect(
        (
          await post(
            `/api/processing/${crypto.randomUUID()}/${action}`,
            userToken,
            {},
          )
        ).status,
      ).toBe(403)
    }
  })

  it('queues accepted files only and fences expired extraction results', async () => {
    const { id } = await submit('Extraction lifecycle')
    const pending = await get('/api/processing/jobs', managerToken)
    expect(await pending.json()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ submissionId: id })]),
    )
    await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'ACCEPTED',
      remarks: 'Approved',
    })
    const db = testDb()
    const [record] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, id))
    const [job] = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.recordId, record.id))
    expect(job.status).toBe('QUEUED')
    const prefix = `/api/processing/${job.id}`
    const claim = await post(prefix + '/claim', managerToken, {})
    expect(claim.status).toBe(200)
    const first = (await claim.json()) as { claimToken: string }
    expect((await post(prefix + '/claim', managerToken, {})).status).toBe(409)
    await db
      .update(processingJobs)
      .set({ leaseUntil: new Date(0) })
      .where(eq(processingJobs.id, job.id))
    const second = (await (
      await post(prefix + '/claim', managerToken, {})
    ).json()) as { claimToken: string }
    const failure = { status: 'FAILED', errorCode: 'NO_EXTRACTABLE_TEXT' }
    expect(
      (
        await post(prefix + '/result', managerToken, {
          ...failure,
          claimToken: first.claimToken,
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await post(prefix + '/result', managerToken, {
          ...failure,
          claimToken: second.claimToken,
        })
      ).status,
    ).toBe(200)
    const [accepted] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, id))
    expect(accepted.status).toBe('ACCEPTED')
    expect((await post(prefix + '/retry', managerToken, {})).status).toBe(200)
    const third = (await (
      await post(prefix + '/claim', managerToken, {})
    ).json()) as { claimToken: string }
    const success = {
      claimToken: third.claimToken,
      status: 'EXTRACTED',
      result: {
        text: 'Extracted study text',
        sha256: 'a'.repeat(64),
        parser: 'test/1',
        pageCount: 1,
        warnings: [],
      },
    }
    expect((await post(prefix + '/result', managerToken, success)).status).toBe(
      200,
    )
    expect((await post(prefix + '/result', managerToken, success)).status).toBe(
      200,
    )
    expect(
      (
        await post(prefix + '/result', managerToken, {
          ...failure,
          claimToken: second.claimToken,
        })
      ).status,
    ).toBe(409)
    expect((await post(prefix + '/claim', managerToken, {})).status).toBe(409)
    const [finished] = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.id, job.id))
    expect(finished.status).toBe('EXTRACTED')
    expect(finished.attempts).toBe(3)
  })

  it('lets only the pinned processing service pull, download, and complete a claim', async () => {
    const { id } = await submit('Service extraction lifecycle')
    await post('/api/decisions', managerToken, {
      submissionId: id,
      status: 'ACCEPTED',
      remarks: 'Approved for service extraction',
    })
    const db = testDb()
    const [record] = await db
      .select()
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, id))
    const [job] = await db
      .select()
      .from(processingJobs)
      .where(eq(processingJobs.recordId, record.id))
    systemAuditEntityIds.push(job.id)

    const claimResponse = await post(
      '/api/internal/processing/claim',
      serviceToken,
      { jobId: job.id },
    )
    expect(claimResponse.status).toBe(200)
    const claim = (await claimResponse.json()) as {
      jobId: string
      claimToken: string
    }
    expect(claim.jobId).toBe(job.id)

    const badDownload = await get(
      `/api/internal/processing/${job.id}/download?claimToken=${crypto.randomUUID()}`,
      serviceToken,
    )
    expect(badDownload.status).toBe(409)
    const download = await get(
      `/api/internal/processing/${job.id}/download?claimToken=${claim.claimToken}`,
      serviceToken,
    )
    expect(download.status).toBe(200)
    expect((await download.arrayBuffer()).byteLength).toBe(777)

    const result = {
      claimToken: claim.claimToken,
      status: 'EXTRACTED',
      result: {
        text: 'Cloud Run extracted study text',
        sha256: 'b'.repeat(64),
        parser: 'suluan-processing/test',
        pageCount: 1,
        warnings: [],
      },
    }
    const resultPath = `/api/internal/processing/${job.id}/result`
    expect((await post(resultPath, serviceToken, result)).status).toBe(200)
    expect((await post(resultPath, serviceToken, result)).status).toBe(200)
    expect(
      (
        await post('/api/internal/processing/claim', serviceToken, {
          jobId: job.id,
        })
      ).status,
    ).toBe(204)

    const audit = await db.query.auditEvents.findFirst({
      where: and(
        eq(auditEvents.entityId, job.id),
        eq(auditEvents.action, 'extraction.completed'),
      ),
    })
    expect(audit?.actorId).toBeNull()
    expect(audit?.context).toMatchObject({
      serviceAccount: 'suluan-processing@test-project.iam.gserviceaccount.com',
    })
  })

  it('lists pending submissions for managers', async () => {
    const { id } = await submit('Awaiting review')
    // Production queues can legitimately contain more than the 50-row page.
    // Put this fixture first rather than assuming a fresh global database.
    await testDb()
      .update(submissions)
      .set({ createdAt: new Date(0) })
      .where(eq(submissions.id, id))
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
    const currentYear = await db.execute(sql`
      select extract(year from current_date)::integer as year
    `)
    expect(records[0].year).toBe((currentYear.rows[0] as { year: number }).year)
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
    const listed = await (
      await get('/api/processing/jobs', managerToken)
    ).json()
    expect(listed).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ submissionId: id })]),
    )
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

  it('sends complete submission metadata and the R2 paper to REO', async () => {
    const db = testDb()
    const [catalog] = await db
      .select({
        schoolId: schools.id,
        schoolName: schools.name,
        courseId: courses.id,
        courseName: courses.name,
      })
      .from(courses)
      .innerJoin(schools, eq(schools.id, courses.schoolId))
      .limit(1)
    const { id } = await submit('Traditional review', 'Author One', catalog)
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, id),
          eq(outboxEvents.eventType, 'submission.created'),
        ),
      )
    let delivered: EmailDraft | undefined
    const adapter = {
      name: 'test-attachment',
      supportsAttachments: true,
      async send(draft: EmailDraft) {
        delivered = draft
        return { providerMessageId: 'test-attachment-id' }
      },
    }
    expect(
      await processOutboxEvent(
        db,
        event.id,
        adapter,
        'reo@ua.edu.ph',
        t.testEnv().DOCUMENTS,
      ),
    ).toBe('sent')
    expect(delivered?.body).toContain('Submitter: author@ua.edu.ph')
    expect(delivered?.body).toContain('Authors: Author One')
    expect(delivered?.body).toContain(`School: ${catalog.schoolName}`)
    expect(delivered?.body).toContain(`Course: ${catalog.courseName}`)
    expect(delivered?.body).toContain('Document: paper.pdf (attached)')
    expect(delivered?.attachment).toMatchObject({
      fileName: 'paper.pdf',
      mimeType: 'application/pdf',
    })
    expect(delivered?.attachment?.bytes).toHaveLength(777)
  })

  it('does not fetch or attach a paper above the email threshold', async () => {
    const { id } = await submit('Large email fallback', 'Author Two')
    const db = testDb()
    await db
      .update(submissionFiles)
      .set({ sizeBytes: MAX_EMAIL_ATTACHMENT_BYTES + 1 })
      .where(eq(submissionFiles.submissionId, id))
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, id),
          eq(outboxEvents.eventType, 'submission.created'),
        ),
      )
    let delivered: EmailDraft | undefined
    const adapter = {
      name: 'test-attachment',
      supportsAttachments: true,
      async send(draft: EmailDraft) {
        delivered = draft
        return { providerMessageId: 'test-large-id' }
      },
    }
    expect(
      await processOutboxEvent(
        db,
        event.id,
        adapter,
        'reo@ua.edu.ph',
        t.testEnv().DOCUMENTS,
      ),
    ).toBe('sent')
    expect(delivered?.attachment).toBeUndefined()
    expect(delivered?.body).toContain(
      'exceeds the 10 MB email attachment limit',
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

  it('recovers a failed send and expired claim without repeating a decision', async () => {
    const { id } = await submit('Retry notification')
    const db = testDb()
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, id))
    const failing = {
      name: 'test',
      supportsAttachments: false,
      async send(): Promise<{ providerMessageId: string }> {
        throw new Error('temporary sender failure')
      },
    }
    await expect(
      processOutboxEvent(db, event.id, failing, 'reo@ua.edu.ph'),
    ).rejects.toThrow('temporary sender failure')
    const [failed] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id))
    expect(failed.processedAt).toBeNull()
    expect(
      await processOutboxEvent(
        db,
        event.id,
        logEmailAdapter(),
        'reo@ua.edu.ph',
      ),
    ).toBe('busy')
    // Simulate an abandoned worker whose lease has expired.
    await db
      .update(outboxEvents)
      .set({ claimToken: crypto.randomUUID(), leaseUntil: new Date(0) })
      .where(eq(outboxEvents.id, event.id))
    // The sweep takes the OLDEST 50 due rows. Suites share one dev database and
    // run in parallel, so a freshly created row sorts behind whatever other
    // files are inserting and can fall outside that window. Backdate this row
    // so it is unambiguously inside the sweep batch; the behaviour under test
    // (an expired claim is re-enqueued) is unchanged.
    await db
      .update(outboxEvents)
      .set({ createdAt: new Date('2000-01-01T00:00:00.000Z') })
      .where(eq(outboxEvents.id, event.id))
    const queued: unknown[] = []
    await sweepOutbox(db, {
      async send(message) {
        queued.push(message)
      },
    })
    expect(queued).toContainEqual({ outboxId: event.id })
    expect(
      await processOutboxEvent(
        db,
        event.id,
        logEmailAdapter(),
        'reo@ua.edu.ph',
      ),
    ).toBe('sent')
    expect(
      await processOutboxEvent(
        db,
        event.id,
        logEmailAdapter(),
        'reo@ua.edu.ph',
      ),
    ).toBe('already-processed')
    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.submissionId, id))
    expect(notes.map((n) => n.status)).toEqual(
      expect.arrayContaining(['FAILED', 'SENT']),
    )
    expect(notes).toHaveLength(2)
  })

  it('keeps concurrent deliveries from dispatching an active claim twice', async () => {
    const { id } = await submit('Concurrent notification')
    const db = testDb()
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, id))
    let release!: () => void
    let entered!: () => void
    const sending = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let sends = 0
    const adapter = {
      name: 'test',
      supportsAttachments: false,
      async send() {
        sends++
        entered()
        await gate
        return { providerMessageId: 'test-concurrent' }
      },
    }
    const first = processOutboxEvent(db, event.id, adapter, 'reo@ua.edu.ph')
    await sending
    try {
      expect(
        await processOutboxEvent(db, event.id, adapter, 'reo@ua.edu.ph'),
      ).toBe('busy')
    } finally {
      release()
    }
    expect(await first).toBe('sent')
    expect(sends).toBe(1)
  })
})
