import { Hono, type MiddlewareHandler } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/app-context'
import { repositoryOperationRoutes } from '../src/repository-operations'

vi.mock('../src/db', () => ({ createDb: vi.fn(() => ({})) }))
vi.mock('../src/notifications', () => ({
  refreshNotifications: vi.fn(async () => ({
    queued: 0,
    hasMore: false,
    queueFailed: false,
  })),
}))

function appFor(role: 'ADMIN' | 'REPOSITORY_MANAGER' | 'USER' | null) {
  const auth: MiddlewareHandler<AppContext> = async (c, next) => {
    if (!role) return c.json({ error: 'unauthorized' }, 401)
    c.set('profile', { id: 'actor', role } as never)
    await next()
  }
  const manager: MiddlewareHandler<AppContext> = async (c, next) => {
    if (c.get('profile').role === 'USER')
      return c.json({ error: 'forbidden' }, 403)
    await next()
  }
  const app = new Hono<AppContext>()
  app.route('/operations', repositoryOperationRoutes(auth, manager))
  return app
}

describe('notification refresh authorization', () => {
  it.each([
    ['ADMIN', 200],
    ['REPOSITORY_MANAGER', 200],
    ['USER', 403],
    [null, 401],
  ] as const)(
    'allows only managers and administrators: %s',
    async (role, status) => {
      const res = await appFor(role).request(
        '/operations/notifications/refresh',
        { method: 'POST' },
        { DATABASE_URL: '', NOTIFICATIONS: {} } as never,
      )
      expect(res.status).toBe(status)
      if (status === 200)
        expect(res.headers.get('cache-control')).toBe('private, no-store')
    },
  )
})
