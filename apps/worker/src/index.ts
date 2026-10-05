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
 * backoff (max_retries in wrangler.toml); poison messages exhaust retries
 * and need operator attention — no silent drops.
 */
async function handleQueue(
  batch: { messages: QueueMessageLike<OutboxMessage>[] },
  env: Env,
) {
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

export default {
  fetch: app.fetch,
  queue: handleQueue,
  async scheduled(_event: unknown, env: Env) {
    await sweepOutbox(createDb(env.DATABASE_URL), env.NOTIFICATIONS)
  },
}
