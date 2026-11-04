import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app'

const db = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('../src/db', () => ({ createDb: () => db }))
const id = '10000000-0000-4000-8000-000000000001'

describe('paper citation-copy count', () => {
  beforeEach(() => db.execute.mockReset())
  it('returns the 90-day aggregate only through the visibility-filtered record query', async () => {
    db.execute.mockResolvedValue({
      rows: [{ id, citationCopyCount: 4, doi: null }],
    })
    const app = createApp(() => ({}) as never)
    const response = await app.request(`/api/records/${id}`, {}, {
      DATABASE_URL: 'unused',
    } as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ citationCopyCount: 4 })
    const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0][0]).sql
    expect(query).toContain("a.event_type = 'CITATION_COPY'")
    expect(query).toContain("a.created_at >= now() - interval '90 days'")
    expect(query).toContain("s.status = 'ACCEPTED'")
    expect(query).toContain('r.visibility')
  })
  it('does not expose a count when the record is invisible', async () => {
    db.execute.mockResolvedValue({ rows: [] })
    const response = await createApp(() => ({}) as never).request(
      `/api/records/${id}`,
      {},
      { DATABASE_URL: 'unused' } as never,
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'record_not_found' })
  })
})
