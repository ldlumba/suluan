import { describe, expect, it, vi } from 'vitest'
import worker, { handleDeadLetters } from '../src/index'
import type { EmailAdapter } from '../src/email'
import type { Env } from '../src/config'

function message(outboxId: string) {
  return {
    body: { outboxId },
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function recordingAdapter(fail = false): {
  adapter: EmailAdapter
  sent: { to: string; subject: string; body: string }[]
} {
  const sent: { to: string; subject: string; body: string }[] = []
  return {
    sent,
    adapter: {
      name: 'test',
      supportsAttachments: false,
      async send(draft) {
        if (fail) throw new Error('alert channel down')
        sent.push(draft)
        return { providerMessageId: 'test-dlq' }
      },
    },
  }
}

describe('handleDeadLetters', () => {
  it('alerts REO with every exhausted outbox id and acks all', async () => {
    const { adapter, sent } = recordingAdapter()
    const msgs = [message('a'), message('b')]
    await handleDeadLetters(msgs, adapter, 'reo@ua.edu.ph')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('reo@ua.edu.ph')
    expect(sent[0].body).toContain('Outbox: a')
    expect(sent[0].body).toContain('Outbox: b')
    expect(sent[0].body).toContain('FAILED')
    for (const msg of msgs) {
      expect(msg.ack).toHaveBeenCalledTimes(1)
      expect(msg.retry).not.toHaveBeenCalled()
    }
  })

  it('acks everything even when the alert itself fails', async () => {
    const { adapter, sent } = recordingAdapter(true)
    const msgs = [message('a')]
    await expect(
      handleDeadLetters(msgs, adapter, 'reo@ua.edu.ph'),
    ).resolves.toBeUndefined()
    expect(sent).toHaveLength(0)
    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
  })

  it('acks without sending when no REO mailbox is configured', async () => {
    const { adapter, sent } = recordingAdapter()
    const msgs = [message('a')]
    await handleDeadLetters(msgs, adapter, undefined)
    expect(sent).toHaveLength(0)
    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
  })

  it('sends nothing for an empty batch', async () => {
    const { adapter, sent } = recordingAdapter()
    await handleDeadLetters([], adapter, 'reo@ua.edu.ph')
    expect(sent).toHaveLength(0)
  })
})

describe('queue entrypoint routing', () => {
  it('routes -dlq batches away from outbox dispatch', async () => {
    // No DATABASE_URL and no Gmail secrets: a DLQ batch must complete
    // without touching the database or the network.
    const msgs = [message('a')]
    await worker.queue(
      { queue: 'suluan-notifications-staging-dlq', messages: msgs },
      { REO_MAILBOX: undefined } as Env,
    )
    expect(msgs[0].ack).toHaveBeenCalledTimes(1)
  })

  it('ignores an empty normal batch without database access', async () => {
    await worker.queue(
      { queue: 'suluan-notifications-staging', messages: [] },
      {} as Env,
    )
  })
})
