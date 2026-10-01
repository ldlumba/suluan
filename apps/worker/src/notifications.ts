import { sql } from 'drizzle-orm'
import { notifications, outboxEvents } from '@suluan/db/schema'
import type { Db } from './db'
import type { EmailAdapter } from './email'

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
    const outcome = await dispatchNotification(db, event, email, reoMailbox)
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
): Promise<'sent' | 'skipped'> {
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
