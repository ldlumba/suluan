import { beforeAll, describe, expect, it } from 'vitest'
import { setupTestAuth, type TestAuth } from './helpers'

/**
 * CORS boundary tests. All database-free: health checks and preflights
 * never touch Neon, so these always run — including on credential-less
 * clones where the DB suites skip.
 */

let t: TestAuth

beforeAll(async () => {
  t = await setupTestAuth()
})

const ALLOWED = 'http://localhost:5173'
const DENIED = 'https://evil.example.com'

function preflight(origin: string | null) {
  const headers: Record<string, string> = {
    'access-control-request-method': 'GET',
  }
  if (origin !== null) headers.origin = origin
  return t.app.request('/api/me', { method: 'OPTIONS', headers }, t.testEnv())
}

describe('CORS', () => {
  it('answers preflight for the configured frontend origin without auth', async () => {
    const res = await preflight(ALLOWED)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('grants no origin to unlisted origins', async () => {
    const res = await preflight(DENIED)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('echoes the allowed origin on real responses', async () => {
    const res = await t.app.request(
      '/api/health',
      { headers: { origin: ALLOWED } },
      t.testEnv(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
  })

  it('passes origin-less requests through untouched', async () => {
    const res = await t.app.request('/api/health', {}, t.testEnv())
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
