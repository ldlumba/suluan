import { neon } from '@neondatabase/serverless'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/neon-http'
import {
  createLocalJWKSet,
  generateKeyPair,
  SignJWT,
  type CryptoKey as JoseCryptoKey,
  type JWTVerifyGetKey,
} from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { profiles } from '@suluan/db/schema'
import { loadRootEnv } from '@suluan/db/scripts/env.mjs'
import { createApp } from '../src/app'
import type { Env } from '../src/config'

const PROJECT_ID = 'test-project'

/**
 * Tokens are minted with a throwaway local RSA key and verified through
 * jose's local JWKS — the full signature/issuer/audience/expiry path runs,
 * with no Google network dependency. Route tests touching the database
 * skip when DATABASE_URL is absent (same pattern as packages/db).
 */

loadRootEnv()

let jwks: JWTVerifyGetKey
let privateKey: JoseCryptoKey
const KID = 'test-key-1'

let app: ReturnType<typeof createApp>

async function mintToken(claims: Record<string, unknown>, key?: JoseCryptoKey) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(`https://securetoken.google.com/${PROJECT_ID}`)
    .setAudience(PROJECT_ID)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key ?? privateKey)
}

function testEnv(): Env {
  return {
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    FIREBASE_PROJECT_ID: PROJECT_ID,
    ALLOWED_DOMAINS: 'ua.edu.ph',
  }
}

function authed(path: string, token: string | null) {
  const headers: Record<string, string> =
    token === null ? {} : { authorization: `Bearer ${token}` }
  return app.request(path, { headers }, testEnv())
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const { exportJWK } = await import('jose')
  const jwk = await exportJWK(pair.publicKey)
  jwks = createLocalJWKSet({
    keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
  })
  app = createApp((projectId) => ({ jwks, projectId }))
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
      .sign(privateKey)
    expect((await authed('/api/me', expired)).status).toBe(401)
  })

  it('rejects tokens for a different project', async () => {
    const other = await new SignJWT({ sub: 'uid-o', email: 'o@ua.edu.ph' })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://securetoken.google.com/other-project')
      .setAudience('other-project')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
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
