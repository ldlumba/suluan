import { beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupTestAuth, testDb, type TestAuth } from './helpers'
import { queryServiceUrl } from '../src/query-transport'

describe('regional tickets', () => {
  let auth: TestAuth
  beforeAll(async () => { auth = await setupTestAuth() })
  it.each(['http://x.run.app', 'https://example.org', 'https://x.run.app/other', 'https://user@x.run.app'])('rejects invalid origin %s', (url) => {
    expect(() => queryServiceUrl(url)).toThrow()
  })
  it('uses a fixed regional endpoint', () => {
    expect(queryServiceUrl('https://query.run.app')).toBe('https://query.run.app/embed')
  })
  const dbIt = process.env.DATABASE_URL ? it : it.skip
  dbIt('redeems a ticket exactly once under concurrency and rejects another workload', async () => {
    const db = testDb()
    const ticket = crypto.randomUUID()
    const env = auth.testEnv()
    const account = 'query@test-project.iam.gserviceaccount.com'
    const token = await auth.mintServiceToken({ email: account })
    const redeem = (bearer: string) => auth.app.request('/api/internal/query-tickets/redeem', {
      method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ticket }),
    }, { ...env, QUERY_SERVICE_ACCOUNT: account, QUERY_SERVICE_AUDIENCE: env.PROCESSING_SERVICE_AUDIENCE })
    await db.execute(sql`insert into embedding_claims (claim_token,kind,inputs,payload,expires_at)
      values (${ticket},'query',1,${JSON.stringify({transport:'interactive-v1',sha256:'a'.repeat(64)})}::jsonb,now()+interval '1 minute')`)
    try {
      expect((await redeem(await auth.mintServiceToken())).status).toBe(401)
      const responses = await Promise.all([redeem(token), redeem(token)])
      expect(responses.map((r) => r.status).sort()).toEqual([200,409])
      expect(await responses.find((r) => r.status === 200)!.json()).toEqual({ sha256: 'a'.repeat(64) })
    } finally {
      await db.execute(sql`delete from embedding_claims where claim_token = ${ticket}`)
    }
  })
})
