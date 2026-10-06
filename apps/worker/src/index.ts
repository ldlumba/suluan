import { productionVerifier } from './auth'
import { createApp } from './app'
import { createDb } from './db'
import {
  gmailEmailAdapter,
  isGmailConfigured,
  logEmailAdapter,
  type EmailAdapter,
} from './email'
import {
  processOutboxEvent,
  sweepOutbox,
  type OutboxMessage,
} from './notifications'
import type { Env, QueueMessageLike } from './config'
import { indexExtractedRecords, KEYWORD_SWEEP_BATCH } from './search'

const app = createApp(productionVerifier)

/** Gmail when its secrets exist, otherwise the auditable log adapter. */
function selectEmailAdapter(env: Env): EmailAdapter {
  if (!isGmailConfigured(env)) return logEmailAdapter()
  return gmailEmailAdapter({
    clientId: env.GMAIL_CLIENT_ID as string,
    clientSecret: env.GMAIL_CLIENT_SECRET as string,
    refreshToken: env.GMAIL_REFRESH_TOKEN as string,
    sender: env.GMAIL_SENDER as string,
  })
}

/**
 * Queue consumer: claims one outbox row per message and dispatches it.
 * The claim is atomic, so redeliveries are safe. Failures retry with
 * backoff (max_retries in wrangler.toml); messages that exhaust retries
 * move to the `-dlq` queue instead of vanishing, and the DLQ branch below
 * pokes REO about them.
 */
async function handleQueue(
  batch: { queue?: string; messages: QueueMessageLike<OutboxMessage>[] },
  env: Env,
) {
  if (typeof batch.queue === 'string' && batch.queue.endsWith('-dlq')) {
    await handleDeadLetters(
      batch.messages,
      selectEmailAdapter(env),
      env.REO_MAILBOX,
    )
    return
  }
  if (batch.messages.length === 0) return
  const db = createDb(env.DATABASE_URL)
  const email = selectEmailAdapter(env)
  for (const msg of batch.messages) {
    try {
      const outcome = await processOutboxEvent(
        db,
        msg.body.outboxId,
        email,
        env.REO_MAILBOX,
        env.DOCUMENTS,
      )
      console.log(`outbox ${msg.body.outboxId}: ${outcome}`)
      if (outcome === 'busy') msg.retry()
      else msg.ack()
    } catch (err) {
      console.error('queue message failed', msg.body, err)
      msg.retry()
    }
  }
}

/**
 * Dead-letter alerts (Stage 7): each message here already failed delivery
 * max_retries times and left FAILED rows behind — those rows are the source
 * of truth, this email is just the poke. Best-effort by design: every
 * message is acknowledged even when the alert itself fails, so the DLQ can
 * never loop. Without the unconditional ack a broken alert path would
 * redeliver forever. Exported for unit tests; the queue entrypoint owns it.
 */
export async function handleDeadLetters(
  messages: QueueMessageLike<OutboxMessage>[],
  email: EmailAdapter,
  reoMailbox: string | undefined,
) {
  if (messages.length === 0) return
  const ids = messages.map((msg) => {
    msg.ack()
    return msg.body.outboxId
  })
  console.error(`dead-letter notifications need operator attention`, ids)
  if (!reoMailbox) return
  try {
    await email.send({
      to: reoMailbox,
      subject: 'SULUAN notification needs operator attention',
      body: [
        `The following notification(s) exhausted all delivery retries.`,
        `Their FAILED rows are recorded; resend manually after fixing the cause.`,
        ...ids.map((id) => `Outbox: ${id}`),
      ].join('\n'),
    })
  } catch (err) {
    console.error('dead-letter alert failed', err)
  }
}

export default {
  fetch: app.fetch,
  queue: handleQueue,
  async scheduled(_event: unknown, env: Env) {
    const db = createDb(env.DATABASE_URL)
    await sweepOutbox(db, env.NOTIFICATIONS)
    const result = await indexExtractedRecords(db, {
      actorId: null,
      context: { trigger: 'scheduled_sweep' },
      limit: KEYWORD_SWEEP_BATCH,
    })
    if (result.indexed > 0) {
      console.log(`keyword index sweep indexed=${result.indexed} hasMore=${result.hasMore}`)
    }
  },
}
