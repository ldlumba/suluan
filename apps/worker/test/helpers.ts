import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey as JoseCryptoKey,
  type JWTVerifyGetKey,
} from 'jose'
import { loadRootEnv } from '@suluan/db/scripts/env.mjs'
import { createApp } from '../src/app'
import type { Env } from '../src/config'

export const PROJECT_ID = 'test-project'
export const KID = 'test-key-1'

/**
 * Shared worker-test harness. Tokens are minted with a throwaway local RSA
 * key and verified through jose's local JWKS — the full
 * signature/issuer/audience/expiry path runs, with no Google network
 * dependency. Route tests touching the database skip when DATABASE_URL is
 * absent (same pattern as packages/db).
 */

loadRootEnv()

export interface TestAuth {
  app: ReturnType<typeof createApp>
  privateKey: JoseCryptoKey
  mintToken: (
    claims: Record<string, unknown>,
    key?: JoseCryptoKey,
  ) => Promise<string>
  testEnv: () => Env
  authed: (
    path: string,
    token: string | null,
    extraHeaders?: Record<string, string>,
  ) => Response | Promise<Response>
}

export async function setupTestAuth(): Promise<TestAuth> {
  const pair = await generateKeyPair('RS256')
  const privateKey = pair.privateKey as JoseCryptoKey
  const jwk = await exportJWK(pair.publicKey)
  const jwks: JWTVerifyGetKey = createLocalJWKSet({
    keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
  })
  const app = createApp(() => ({ jwks, projectId: PROJECT_ID }))

  async function mintToken(
    claims: Record<string, unknown>,
    key?: JoseCryptoKey,
  ) {
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
      ALLOWED_ORIGINS: 'http://localhost:5173',
    }
  }

  function authed(
    path: string,
    token: string | null,
    extraHeaders?: Record<string, string>,
  ) {
    const headers: Record<string, string> = { ...extraHeaders }
    if (token !== null) headers.authorization = `Bearer ${token}`
    return app.request(path, { headers }, testEnv())
  }

  return { app, privateKey, mintToken, testEnv, authed }
}
