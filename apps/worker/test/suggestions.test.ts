import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app'

const db = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('../src/db', () => ({ createDb: () => db }))

describe('title suggestions', () => {
  it('requires three characters and applies public visibility and accepted status', async () => {
    const app = createApp(() => ({}) as never)
    const env = { DATABASE_URL: 'unused' } as never
    expect(
      (await app.request('/api/search/suggestions?q=ab', {}, env)).status,
    ).toBe(400)
    db.execute.mockResolvedValue({ rows: [] })
    const response = await app.request(
      '/api/search/suggestions?q=farm',
      {},
      env,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const query = new PgDialect().sqlToQuery(
      db.execute.mock.calls.at(-1)![0],
    ).sql
    expect(query).toContain("s.status = 'ACCEPTED'")
    expect(query).toContain('r.visibility')
    expect(query).toContain('limit 5')
  })
})
