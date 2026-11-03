import { Hono, type MiddlewareHandler } from 'hono'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/app-context'
import { recordAccessRoutes } from '../src/record-access'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('../src/db', () => ({ createDb: () => ({ execute: mocks.execute }) }))
const recordId = '10000000-0000-4000-8000-000000000001'
const input = {
  visibility: 'RESTRICTED',
  embargoUntil: null,
  expectedUpdatedAt: '2026-11-01T10:00:00Z',
}

function appFor(role: 'ADMIN' | 'REPOSITORY_MANAGER' | 'USER' | null) {
  const auth: MiddlewareHandler<AppContext> = async (c, next) => {
    if (!role) return c.json({ error: 'unauthorized' }, 401)
    c.set('profile', { id: recordId, role } as never)
    await next()
  }
  const manager: MiddlewareHandler<AppContext> = async (c, next) => {
    if (c.get('profile').role === 'USER')
      return c.json({ error: 'forbidden' }, 403)
    await next()
  }
  const app = new Hono<AppContext>()
  app.use('*', async (c, next) => {
    c.env = { DATABASE_URL: 'unused' } as never
    await next()
  })
  app.route('/access', recordAccessRoutes(auth, manager))
  return app
}

describe('record access management', () => {
  beforeEach(() => mocks.execute.mockReset())
  it.each([
    ['USER', 403],
    [null, 401],
  ] as const)('denies %s', async (role, status) => {
    const app = appFor(role)
    expect((await app.request('/access')).status).toBe(status)
    expect(
      (
        await app.request(`/access/${recordId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(status)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each(['ADMIN', 'REPOSITORY_MANAGER'] as const)(
    'allows %s to browse accepted records',
    async (role) => {
      mocks.execute.mockResolvedValue({ rows: [] })
      const res = await appFor(role).request('/access')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
      expect(
        new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).sql,
      ).toContain("s.status = 'ACCEPTED'")
    },
  )
  it('uses a fenced update and atomic audit, rejecting stale writes', async () => {
    mocks.execute.mockResolvedValue({ rows: [] })
    const res = await appFor('ADMIN').request(`/access/${recordId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    expect(res.status).toBe(409)
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]).sql
    expect(query).toContain('r.updated_at =')
    expect(query).toContain('for update of r')
    expect(query).toContain('insert into audit_events')
    expect(query).toContain("s.status = 'ACCEPTED'")
  })
  it('returns success only when the audited update returns a record', async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: recordId }] })
    const res = await appFor('REPOSITORY_MANAGER').request(
      `/access/${recordId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
  it('rejects an embargo on public access', async () => {
    const res = await appFor('ADMIN').request(`/access/${recordId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        visibility: 'PUBLIC',
        embargoUntil: '2099-01-01',
      }),
    })
    expect(res.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
