import { sql } from 'drizzle-orm'
import { notifications, outboxEvents } from '@suluan/db/schema'
import type { Db } from './db'
import type { EmailAdapter, EmailAttachment } from './email'
import type { R2BucketLike } from './config'

/**
 * Conservative ceiling for the source file before MIME/base64 expansion.
 * Gmail and Worker memory limits apply to the encoded message, not just the
 * R2 object. Ten MiB leaves headroom for both nested encodings and metadata.
 */
export const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface OutboxMessage {
  outboxId: string
}

/**
 * Expiring claims recover after crashes. Completion is recorded only after
 * dispatch. External email remains at-least-once across a send/DB crash;
 * a future real adapter must account for that ambiguity.
 */
export async function processOutboxEvent(
  db: Db,
  outboxId: string,
  email: EmailAdapter,
  reoMailbox?: string,
  documents?: R2BucketLike,
): Promise<'sent' | 'skipped' | 'already-processed' | 'busy'> {
  const claimToken = crypto.randomUUID()
  const claimed = await db.execute(sql`
    update outbox_events
    set claim_token = ${claimToken}, lease_until = now() + interval '5 minutes'
    where id = ${outboxId} and processed_at is null
      and (lease_until is null or lease_until < now())
    returning id, event_type as "eventType", payload
  `)
  if (claimed.rows.length === 0) {
    const current = await db.execute(sql`
      select processed_at from outbox_events where id = ${outboxId}
    `)
    return current.rows.length && current.rows[0].processed_at === null
      ? 'busy'
      : 'already-processed'
  }
  const event = claimed.rows[0] as {
    id: string
    eventType: string
    payload: Record<string, string> | null
  }
  try {
    const outcome = await dispatchNotification(
      db,
      event,
      email,
      reoMailbox,
      documents,
    )
    await db.execute(sql`
      update outbox_events set processed_at = now(), claim_token = null, lease_until = null
      where id = ${outboxId} and claim_token = ${claimToken}
    `)
    return outcome
  } catch (err) {
    await db.execute(sql`
      update outbox_events set claim_token = null, lease_until = now() + interval '1 minute'
      where id = ${outboxId} and claim_token = ${claimToken}
    `)
    throw err
  }
}

async function dispatchNotification(
  db: Db,
  event: { eventType: string; payload: Record<string, string> | null },
  email: EmailAdapter,
  reoMailbox?: string,
  documents?: R2BucketLike,
): Promise<'sent' | 'skipped'> {
  const payload = event.payload ?? {}

  interface Draft {
    to: string | null
    kind: string
    subject: string
    body: string
    attachment?: EmailAttachment
  }
  let draft: Draft | null = null
  if (event.eventType === 'submission.created') {
    const details = await submissionEmailDetails(db, payload.submissionId)
    const attachment = await loadEmailAttachment(details, email, documents)
    const documentLine = details?.fileName
      ? attachment
        ? `${details.fileName} (attached)`
        : details.sizeBytes > MAX_EMAIL_ATTACHMENT_BYTES
          ? `${details.fileName} (not attached: file exceeds the 10 MB email attachment limit; review it in SULUAN)`
          : `${details.fileName} (available in SULUAN; attachment unavailable for this sender)`
      : '(not available)'
    draft = {
      kind: 'reo_new_submission',
      to: reoMailbox ?? null,
      subject: `New SULUAN submission: ${payload.title ?? payload.submissionId}`,
      body: [
        `A new submission is awaiting REO review.`,
        `Submission: ${payload.submissionId}`,
        `Submitter: ${payload.submitterEmail ?? '(unknown)'}`,
        `Title: ${payload.title ?? '(untitled)'}`,
        `Authors: ${details?.authors ?? '(not provided)'}`,
        `School: ${details?.school ?? '(not provided)'}`,
        `Course: ${details?.course ?? '(not provided)'}`,
        `Document: ${documentLine}`,
      ].join('\n'),
      attachment,
    }
  } else if (event.eventType === 'decision.made') {
    const accepted = payload.status === 'ACCEPTED'
    draft = {
      kind: 'submitter_decision',
      to: payload.submitterEmail ?? null,
      subject: accepted
        ? `Your SULUAN submission was accepted: ${payload.title ?? ''}`.trim()
        : `Update on your SULUAN submission: ${payload.title ?? ''}`.trim(),
      body: [
        `Submission: ${payload.submissionId}`,
        `Decision: ${payload.status}`,
        `Remarks: ${payload.remarks ?? ''}`,
      ].join('\n'),
    }
  }

  if (!draft) {
    await db.insert(notifications).values({
      submissionId: payload.submissionId ?? null,
      recipientEmail: null,
      kind: `unhandled:${event.eventType}`,
      status: 'SKIPPED',
      provider: email.name,
      error: `no handler for event type ${event.eventType}`,
    })
    return 'skipped'
  }

  const { to, kind, subject, body, attachment } = draft
  if (!to) {
    await db.insert(notifications).values({
      submissionId: payload.submissionId ?? null,
      recipientEmail: null,
      kind,
      status: 'SKIPPED',
      provider: email.name,
      error: 'no recipient configured yet',
    })
    return 'skipped'
  }

  try {
    const { providerMessageId } = await email.send({
      to,
      subject,
      body,
      attachment,
    })
    await db.insert(notifications).values({
      submissionId: payload.submissionId ?? null,
      recipientEmail: to,
      kind,
      status: 'SENT',
      provider: email.name,
      providerMessageId,
      sentAt: new Date(),
    })
    return 'sent'
  } catch (err) {
    await db.insert(notifications).values({
      submissionId: payload.submissionId ?? null,
      recipientEmail: to,
      kind,
      status: 'FAILED',
      provider: email.name,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

interface SubmissionEmailDetails {
  authors: string | null
  school: string | null
  course: string | null
  r2Key: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

async function submissionEmailDetails(
  db: Db,
  submissionId: string | undefined,
): Promise<SubmissionEmailDetails | null> {
  if (!submissionId) return null
  const result = await db.execute(sql`
    select s.authors, sc.name as school, c.name as course,
      sf.r2_key as "r2Key", sf.file_name as "fileName",
      sf.mime_type as "mimeType", sf.size_bytes::text as "sizeBytes"
    from submissions s
    left join schools sc on sc.id = s.school_id
    left join courses c on c.id = s.course_id
    join submission_files sf on sf.submission_id = s.id
    where s.id = ${submissionId}
    order by sf.uploaded_at asc
    limit 1
  `)
  if (result.rows.length === 0) return null
  const row = result.rows[0] as Omit<SubmissionEmailDetails, 'sizeBytes'> & {
    sizeBytes: string | null
  }
  return {
    ...row,
    mimeType: row.mimeType || 'application/octet-stream',
    sizeBytes: Number(row.sizeBytes ?? 0),
  }
}

async function loadEmailAttachment(
  details: SubmissionEmailDetails | null,
  email: EmailAdapter,
  documents?: R2BucketLike,
): Promise<EmailAttachment | undefined> {
  if (
    !details ||
    !email.supportsAttachments ||
    !documents ||
    details.sizeBytes > MAX_EMAIL_ATTACHMENT_BYTES
  ) {
    return undefined
  }
  const object = await documents.get(details.r2Key)
  if (!object) throw new Error('notification attachment missing from R2')
  if (object.size > MAX_EMAIL_ATTACHMENT_BYTES) return undefined
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
  return {
    fileName: details.fileName,
    mimeType: details.mimeType,
    bytes,
  }
}

export { outboxEvents }

/** Bounded sweep recovers failed enqueue and exhausted queue deliveries. */
export async function sweepOutbox(
  db: Db,
  queue: { send(message: unknown): Promise<void> },
) {
  const due = await db.execute(sql`
    select id from outbox_events
    where processed_at is null and (lease_until is null or lease_until < now())
    order by created_at limit 50
  `)
  for (const row of due.rows) {
    await queue.send({ outboxId: row.id })
  }
}
