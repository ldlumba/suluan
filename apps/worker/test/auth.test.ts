import { neon } from '@neondatabase/serverless'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import { generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { profiles } from '@suluan/db/schema'
import { KID, PROJECT_ID, setupTestAuth, type TestAuth } from './helpers'

let t: TestAuth
let authed: TestAuth['authed']
let mintToken: TestAuth['mintToken']

beforeAll(async () => {
  t = await setupTestAuth()
  authed = t.authed
  mintToken = t.mintToken
})

describe('token verification', () => {
  it('rejects requests without a token', async () => {
    expect((await authed('/api/me', null)).status).toBe(401)
  })

  it('rejects malformed tokens', async () => {
    expect((await authed('/api/me', 'not-a-token')).status).toBe(401)
  })

  it('rejects tokens signed by an unknown key', async () => {
    const other = await generateKeyPair('RS256')
    const token = await mintToken(
      { sub: 'uid-x', email: 'x@ua.edu.ph' },
      other.privateKey,
    )
    expect((await authed('/api/me', token)).status).toBe(401)
  })

  it('rejects expired tokens', async () => {
    const expired = await new SignJWT({ sub: 'uid-e', email: 'e@ua.edu.ph' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(`https://securetoken.google.com/${PROJECT_ID}`)
      .setAudience(PROJECT_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(t.privateKey)
    expect((await authed('/api/me', expired)).status).toBe(401)
  })

  it('rejects tokens for a different project', async () => {
    const other = await new SignJWT({ sub: 'uid-o', email: 'o@ua.edu.ph' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://securetoken.google.com/other-project')
      .setAudience('other-project')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(t.privateKey)
    expect((await authed('/api/me', other)).status).toBe(401)
  })

  it('rejects tokens without an email claim', async () => {
    const token = await mintToken({ sub: 'uid-noemail' })
    expect((await authed('/api/me', token)).status).toBe(401)
  })
})

describe('domain allowlist', () => {
  it('rejects non-UA addresses with 403', async () => {
    const token = await mintToken({ sub: 'uid-g', email: 'someone@gmail.com' })
    expect((await authed('/api/me', token)).status).toBe(403)
  })

  it('rejects lookalike domains', async () => {
    const token = await mintToken({ sub: 'uid-f', email: 'x@fakeua.edu.ph' })
    expect((await authed('/api/me', token)).status).toBe(403)
  })
})

describe('processing service identity', () => {
  function serviceRequest(token: string | null, env = t.testEnv()) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (token) headers.authorization = `Bearer ${token}`
    return t.app.request(
      '/api/internal/processing/claim',
      { method: 'POST', headers, body: JSON.stringify({ jobId: 'invalid' }) },
      env,
    )
  }

  it('requires a Google workload token rather than a Firebase user token', async () => {
    expect((await serviceRequest(null)).status).toBe(401)
    const firebase = await mintToken({
      sub: 'uid-service',
      email: 'boss@ua.edu.ph',
    })
    expect((await serviceRequest(firebase)).status).toBe(401)
  })

  it('pins the exact configured service account', async () => {
    const wrong = await t.mintServiceToken({
      email: 'other@test-project.iam.gserviceaccount.com',
    })
    expect((await serviceRequest(wrong)).status).toBe(401)
  })

  it('pins the exact Worker audience', async () => {
    const wrongAudience = await new SignJWT({
      sub: 'processing-service-subject',
      email: 'suluan-processing@test-project.iam.gserviceaccount.com',
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://accounts.google.com')
      .setAudience('https://wrong-audience.example')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(t.privateKey)
    expect((await serviceRequest(wrongAudience)).status).toBe(401)
  })

  it('accepts the configured workload before request validation', async () => {
    const token = await t.mintServiceToken()
    // Invalid UUID proves authentication passed without touching Neon.
    expect((await serviceRequest(token)).status).toBe(400)
    expect((await authed('/api/processing/jobs', token)).status).toBe(401)
  })

  it('fails closed when service identity configuration is absent', async () => {
    const token = await t.mintServiceToken()
    const env = {
      ...t.testEnv(),
      PROCESSING_SERVICE_AUDIENCE: undefined,
      PROCESSING_SERVICE_ACCOUNT: undefined,
    }
    expect((await serviceRequest(token, env)).status).toBe(503)
  })
})

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('protected routes with database', () => {
  const createdUids: string[] = []

  afterAll(async () => {
    if (createdUids.length === 0) return
    const db = drizzle(neon(process.env.DATABASE_URL!))
    for (const uid of createdUids) {
      await db.delete(profiles).where(eq(profiles.firebaseUid, uid))
    }
  })

  it('auto-creates a USER profile on first sign-in', async () => {
    const uid = `test-uid-user-${Date.now()}`
    createdUids.push(uid)
    const token = await mintToken({ sub: uid, email: 'newcomer@ua.edu.ph' })
    const res = await authed('/api/me', token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { email: string; role: string }
    expect(body).toMatchObject({ email: 'newcomer@ua.edu.ph', role: 'USER' })
  })

  it('denies USER profiles on admin routes and reflects the DB role', async () => {
    const uid = `test-uid-denied-${Date.now()}`
    createdUids.push(uid)
    const token = await mintToken({ sub: uid, email: 'plain@ua.edu.ph' })
    // Role comes from Neon, not the client: /api/me reports USER…
    const me = await authed('/api/me', token)
    expect(((await me.json()) as { role: string }).role).toBe('USER')
    // …and the admin probe refuses.
    expect((await authed('/api/admin/status', token)).status).toBe(403)
  })

  it('admits ADMIN profiles on admin routes', async () => {
    const uid = `test-uid-admin-${Date.now()}`
    createdUids.push(uid)
    const db = drizzle(neon(process.env.DATABASE_URL!))
    await db
      .insert(profiles)
      .values({ firebaseUid: uid, email: 'boss@ua.edu.ph', role: 'ADMIN' })
    const token = await mintToken({ sub: uid, email: 'boss@ua.edu.ph' })
    const res = await authed('/api/admin/status', token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ scope: 'admin' })
  })
})
