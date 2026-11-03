import { Hono, type MiddlewareHandler } from 'hono'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../src/app-context'
import { repositoryOperationRoutes } from '../src/repository-operations'

const db = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('../src/db', () => ({ createDb: () => db }))

describe('manual repository operation launch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })
  it.each(['extraction', 'embedding'])(
    'casts the audited %s action before dispatch',
    async (action) => {
      db.execute
        .mockResolvedValueOnce({ rows: [{ ready: true }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'operation-id' }] })
      const send = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ executionName: 'job' }), {
          status: 202,
        }),
      )
      vi.stubGlobal('fetch', send)
      const auth: MiddlewareHandler<AppContext> = async (c, next) => {
        c.set('profile', { id: 'actor', role: 'ADMIN' } as never)
        await next()
      }
      const app = new Hono<AppContext>()
      app.route(
        '/operations',
        repositoryOperationRoutes(auth, async (_c, next) => next()),
      )
      const response = await app.request(
        `/operations/${action}`,
        { method: 'POST' },
        {
          DATABASE_URL: '',
          OPERATIONS_DISPATCHER_URL: 'https://dispatcher.example/dispatch',
        } as never,
      )
      expect(response.status).toBe(202)
      const sql = new PgDialect().sqlToQuery(db.execute.mock.calls[3][0]).sql
      expect(sql).toMatch(/jsonb_build_object\('operation',\s*\$\d+::text\)/)
      expect(send).toHaveBeenCalledOnce()
    },
  )
})
