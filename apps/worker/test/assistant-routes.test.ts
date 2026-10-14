import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  assistantEndpoint,
  assistantAccessAllowed,
  assistantPilotAllowed,
  expireAssistantRequests,
  buildAssistantRetrievalQuery,
  hashPayload,
  reserveAssistant,
  validateAnswer,
} from '../src/assistant-routes'
import {
  setupTestAuth,
  testDb,
  insertProfile,
  deleteProfiles,
  type TestAuth,
} from './helpers'

describe('assistant output boundary', () => {
  it('requires an explicit exact pilot email, including for managers', () => {
    expect(assistantPilotAllowed('person@ua.edu.ph')).toBe(false)
    expect(assistantPilotAllowed('person@ua.edu.ph', '*')).toBe(false)
    expect(assistantPilotAllowed('other@ua.edu.ph', 'person@ua.edu.ph')).toBe(
      false,
    )
    expect(assistantPilotAllowed('PERSON@ua.edu.ph', 'person@ua.edu.ph')).toBe(
      true,
    )
    expect(assistantAccessAllowed('other@ua.edu.ph', 'all_authenticated')).toBe(
      true,
    )
    expect(assistantAccessAllowed('other@ua.edu.ph', 'pilot')).toBe(false)
  })
  it('rejects invented citations and malformed answers', () => {
    expect(() =>
      validateAnswer(
        {
          mode: 'grounded_answer',
          paragraphs: [{ text: 'Claim', citations: ['S2'] }],
        },
        ['S1'],
      ),
    ).toThrow()
    expect(() =>
      validateAnswer({ mode: 'grounded_answer', paragraphs: [] }, ['S1']),
    ).toThrow()
    expect(() =>
      validateAnswer(
        {
          mode: 'grounded_answer',
          paragraphs: [{ text: 'Claim', citations: [] }],
        },
        ['S1'],
      ),
    ).toThrow()
    expect(
      validateAnswer(
        {
          mode: 'general_guidance',
          paragraphs: [
            { text: 'Consider narrowing the population.', citations: [] },
          ],
        },
        [],
      ),
    ).toEqual({
      mode: 'general_guidance',
      paragraphs: [
        { text: 'Consider narrowing the population.', citations: [] },
      ],
    })
    expect(() =>
      validateAnswer(
        {
          mode: 'general_guidance',
          paragraphs: [
            { text: 'Unsupported repository claim', citations: ['S1'] },
          ],
        },
        ['S1'],
      ),
    ).toThrow()
  })
  it('builds retrieval context from user questions only within the prompt limit', () => {
    const query = buildAssistantRetrievalQuery('What about their methods?', [
      { question: 'Tell me about student mental health.' },
      { question: 'Which populations were studied?' },
    ])
    expect(query).toContain('What about their methods?')
    expect(query).toContain('Which populations were studied?')
    expect(query.length).toBeLessThanOrEqual(1000)
  })
  it('rejects arbitrary service destinations', () => {
    for (const url of [
      'http://x.run.app',
      'https://evil.example',
      'https://x.run.app/path',
      'https://user@x.run.app',
    ]) {
      expect(() => assistantEndpoint(url, 'generate')).toThrow()
    }
  })
})

const dbDescribe = process.env.DATABASE_URL ? describe : describe.skip
dbDescribe('assistant authorization and reservations', () => {
  let t: TestAuth, token: string, actor: string
  const uid = `assistant-${crypto.randomUUID()}`
  beforeAll(async () => {
    t = await setupTestAuth()
    await insertProfile(testDb(), uid, `${uid}@ua.edu.ph`, 'USER')
    token = await t.mintToken({ sub: uid, email: `${uid}@ua.edu.ph` })
    const p = await testDb().execute(
      sql`select id from profiles where firebase_uid = ${uid}`,
    )
    actor = String(p.rows[0].id)
  })
  afterAll(async () => {
    // Remove only this fixture's aggregate reservations; repeated tests must
    // not exhaust the shared development allowance or erase another user.
    await testDb().execute(sql`update assistant_usage u
      set requests = greatest(0, u.requests - own.requests)
      from (select (created_at at time zone 'UTC')::date as day, count(*)::int as requests
        from assistant_requests where actor_id = ${actor} group by 1) own
      where u.actor_key = 'all' and u.day = own.day`)
    await testDb().execute(
      sql`delete from assistant_usage where actor_key = ${actor}`,
    )
    await deleteProfiles(testDb(), [uid])
  })
  it('denies anonymous callers and reports disabled availability without paid work', async () => {
    expect(
      (await t.app.request('/api/assistant/limits', {}, t.testEnv())).status,
    ).toBe(401)
    const r = await t.app.request(
      '/api/assistant/limits',
      { headers: { authorization: `Bearer ${token}` } },
      t.testEnv(),
    )
    expect(await r.json()).toMatchObject({
      enabled: false,
      used: 0,
      limits: { messagesPerUserPerDay: 10 },
    })
  })
  it('arbitrates replays, rate limits, owner isolation and ten-turn limits', async () => {
    const db = testDb(),
      session = crypto.randomUUID(),
      request = crypto.randomUUID()
    const pair = await Promise.all([
      reserveAssistant(db, actor, session, request),
      reserveAssistant(db, actor, session, request),
    ])
    expect(pair.filter((p) => p.allowed)).toHaveLength(1)
    const cooldown = await reserveAssistant(
      db,
      actor,
      session,
      crypto.randomUUID(),
    )
    expect(cooldown.allowed).toBe(false)
    expect(cooldown.reason).toBe('cooldown')
    expect(cooldown.retryAfterSeconds).toBeGreaterThan(0)
    await db.execute(
      sql`update assistant_usage set last_started_at = now() - interval '1 minute'
        where actor_key = ${actor}`,
    )
    await db.execute(
      sql`update assistant_sessions set turns = 10 where id = ${session}`,
    )
    const exhausted = await reserveAssistant(
      db,
      actor,
      session,
      crypto.randomUUID(),
    )
    expect(exhausted.allowed).toBe(false)
    expect(exhausted.reason).toBe('conversation')
    // Different profile cannot use an existing session, even with guessed IDs.
    expect(
      (
        await reserveAssistant(
          db,
          crypto.randomUUID(),
          session,
          crypto.randomUUID(),
        )
      ).allowed,
    ).toBe(false)
  })
  it('pins workload identity, binds payload hash and rejects stage/replay confusion', async () => {
    const db = testDb()
    await db.execute(
      sql`update assistant_usage set last_started_at = now() - interval '1 minute' where actor_key = ${actor}`,
    )
    const request = crypto.randomUUID()
    const grant = await reserveAssistant(
      db,
      actor,
      crypto.randomUUID(),
      request,
    )
    expect(grant.allowed).toBe(true)
    const hash = await hashPayload('{"query":"test"}')
    await db.execute(
      sql`update assistant_requests set embed_hash = ${hash} where id = ${request}`,
    )
    const env = {
      ...t.testEnv(),
      ASSISTANT_SERVICE_URL: 'https://assistant.run.app',
      ASSISTANT_SERVICE_ACCOUNT: 'assistant@test.iam.gserviceaccount.com',
      ASSISTANT_SERVICE_AUDIENCE: 'https://api.test.suluan.example',
    }
    const service = await t.mintServiceToken({
      email: env.ASSISTANT_SERVICE_ACCOUNT,
      aud: env.ASSISTANT_SERVICE_AUDIENCE,
    })
    const redeem = (bearer: string, stage = 'embed') =>
      t.app.request(
        '/api/internal/assistant-tickets/redeem',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ticket: grant.embedTicket, stage }),
        },
        env,
      )
    expect((await redeem(token)).status).toBe(401)
    expect((await redeem(service, 'generate')).status).toBe(409)
    expect(await (await redeem(service)).json()).toEqual({ sha256: hash })
    expect((await redeem(service)).status).toBe(409)
  })
  it('enforces the per-user daily cap under simultaneous requests without creating sessions', async () => {
    const db = testDb()
    await db.execute(sql`update assistant_usage set requests = 9,
      last_started_at = now() - interval '1 minute' where actor_key = ${actor}`)
    const sessions = [crypto.randomUUID(), crypto.randomUUID()]
    const grants = await Promise.all(
      sessions.map((session) =>
        reserveAssistant(db, actor, session, crypto.randomUUID()),
      ),
    )
    expect(grants.filter((grant) => grant.allowed)).toHaveLength(1)
    const usage = await db.execute(
      sql`select requests from assistant_usage where actor_key = ${actor}`,
    )
    expect(Number(usage.rows[0].requests)).toBe(10)
    const denied = await reserveAssistant(
      db,
      actor,
      crypto.randomUUID(),
      crypto.randomUUID(),
    )
    expect(denied.allowed).toBe(false)
    const saved = await db.execute(
      sql`select id from assistant_sessions where id in (${sessions[0]}, ${sessions[1]})`,
    )
    expect(saved.rows).toHaveLength(1)
  })
  it('scrubs abandoned digests and denies non-pilot users before reservation', async () => {
    const db = testDb()
    await db.execute(sql`update assistant_requests set expires_at = now() - interval '1 minute',
      embed_hash = 'digest' where actor_id = ${actor} and status = 'reserved'`)
    await expireAssistantRequests(db)
    const rows =
      await db.execute(sql`select id from assistant_requests where actor_id = ${actor}
      and (embed_hash is not null or status = 'reserved')`)
    expect(rows.rows).toHaveLength(0)
    const response = await t.app.request(
      '/api/assistant/messages',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          prompt: 'test',
        }),
      },
      { ...t.testEnv(), ASSISTANT_PILOT_EMAILS: 'other@ua.edu.ph' },
    )
    expect(response.status).toBe(403)
  })
  it('requires adult confirmation for all-UA production access', async () => {
    const env = {
      ...t.testEnv(),
      ASSISTANT_ACCESS_MODE: 'all_authenticated' as const,
      ASSISTANT_SERVICE_URL: 'https://assistant.run.app',
      ASSISTANT_SERVICE_ACCOUNT: 'assistant@test.iam.gserviceaccount.com',
      ASSISTANT_SERVICE_AUDIENCE: 'https://api.test.suluan.example',
    }
    const response = await t.app.request(
      '/api/assistant/messages',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          prompt: 'test',
        }),
      },
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: 'adult_confirmation_required',
    })
  })
  it('denies the aggregate daily cap before issuing a request ticket', async () => {
    const db = testDb()
    const prior = await db.execute(sql`select requests from assistant_usage
      where actor_key = 'all' and day = (now() at time zone 'UTC')::date`)
    const count = Number(prior.rows[0].requests)
    try {
      await db.execute(sql`update assistant_usage set requests = 300
        where actor_key = 'all' and day = (now() at time zone 'UTC')::date`)
      await db.execute(sql`update assistant_usage set requests = 0,
        last_started_at = now() - interval '1 minute' where actor_key = ${actor}`)
      const id = crypto.randomUUID()
      expect(
        (await reserveAssistant(db, actor, crypto.randomUUID(), id)).allowed,
      ).toBe(false)
      const rows = await db.execute(
        sql`select id from assistant_requests where id = ${id}`,
      )
      expect(rows.rows).toHaveLength(0)
    } finally {
      await db.execute(sql`update assistant_usage set requests = ${count}
        where actor_key = 'all' and day = (now() at time zone 'UTC')::date`)
    }
  })
})
