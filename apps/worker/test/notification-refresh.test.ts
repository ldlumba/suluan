import { describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { refreshNotifications } from '../src/notifications'
import type { Db } from '../src/db'

describe('manual notification refresh', () => {
  it('selects only due unprocessed notifications, audits first, and queues at most 50', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: Array.from({ length: 51 }, (_, i) => ({ id: String(i) })),
      })
      .mockResolvedValueOnce({ rows: [] })
    const send = vi.fn().mockResolvedValue(undefined)
    const result = await refreshNotifications(
      { execute } as unknown as Db,
      { send },
      'actor',
    )
    const dialect = new PgDialect()
    const query = dialect.sqlToQuery(execute.mock.calls[0][0]).sql
    expect(query).toContain('processed_at is null')
    expect(query).toContain('lease_until < now()')
    expect(query).toContain('limit 51')
    expect(query).toContain("'decision.made'")
    expect(execute.mock.invocationCallOrder[1]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    )
    expect(send).toHaveBeenCalledTimes(50)
    expect(result).toEqual({ queued: 50, hasMore: true, queueFailed: false })
  })

  it('reports partial enqueue failure without claiming delivery', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: '1' }, { id: '2' }] })
      .mockResolvedValueOnce({ rows: [] })
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('queue unavailable'))
    expect(
      await refreshNotifications(
        { execute } as unknown as Db,
        { send },
        'actor',
      ),
    ).toEqual({ queued: 1, hasMore: false, queueFailed: true })
  })

  it('does not enqueue if auditing fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
      .mockRejectedValueOnce(new Error('audit failed'))
    const send = vi.fn()
    await expect(
      refreshNotifications({ execute } as unknown as Db, { send }, 'actor'),
    ).rejects.toThrow('audit failed')
    expect(send).not.toHaveBeenCalled()
  })
})
