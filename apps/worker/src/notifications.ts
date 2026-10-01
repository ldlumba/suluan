import { sql } from 'drizzle-orm'
import { notifications, outboxEvents } from '@suluan/db/schema'
import type { Db } from './db'
import type { EmailAdapter } from './email'

export interface OutboxMessage {
  outboxId: string
}

/**
 * Claim one outbox row and dispatch it. The UPDATE … WHERE processed_at IS
 * NULL is the atomic claim: concurrent or retried deliveries re-check it,
 * so only the first claimer dispatches. Returns what happened for logging.
 */
export async function processOutboxEvent(
  db: Db,
  outboxId: string,
  email: EmailAdapter,
  reoMailbox?: string,
): Promise<'sent' | 'skipped' | 'already-processed'> {
  const claimed = await db.execute(sql`
    update outbox_events set processed_at = now()
    where id = ${outboxId} and processed_at is null
    returning id, event_type as "eventType", payload
  `)
  if (claimed.rows.length === 0) return 'already-processed'
  const event = claimed.rows[0] as {
    id: string
    eventType: string
    payload: Record<string, string> | null
  }
  const payload = event.payload ?? {}

  interface Draft {
    to: string | null
    kind: string
    subject: string
    body: string
  }
  let draft: Draft | null = null
  if (event.eventType === 'submission.created') {
    draft = {
      kind: 'reo_new_submission',
      to: reoMailbox ?? null,
      subject: `New SULUAN submission: ${payload.title ?? payload.submissionId}`,
      body: [
        `A new submission is awaiting REO review.`,
        `Submission: ${payload.submissionId}`,
        `Title: ${payload.title ?? '(untitled)'}`,
        `Submitter: ${payload.submitterEmail ?? '(unknown)'}`,
      ].join('\n'),
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

  const { to, kind, subject, body } = draft
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
    const { providerMessageId } = await email.send({ to, subject, body })
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

export { outboxEvents }
