import { productionVerifier } from './auth'
import { createApp } from './app'
import { createDb } from './db'
import { logEmailAdapter } from './email'
import { processOutboxEvent, type OutboxMessage } from './notifications'
import type { Env, QueueMessageLike } from './config'

const app = createApp(productionVerifier)

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
  // Log adapter until the Gmail sender is authorized (Architecture v1 §12).
  const email = logEmailAdapter()
  for (const msg of batch.messages) {
    try {
      const outcome = await processOutboxEvent(
        db,
        msg.body.outboxId,
        email,
        env.REO_MAILBOX,
      )
      console.log(`outbox ${msg.body.outboxId}: ${outcome}`)
      msg.ack()
    } catch (err) {
      console.error('queue message failed', msg.body, err)
      msg.retry()
    }
  }
}

export default {
  fetch: app.fetch,
  queue: handleQueue,
}
