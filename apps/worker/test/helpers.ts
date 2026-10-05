import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey as JoseCryptoKey,
  type JWTVerifyGetKey,
} from 'jose'
import { loadRootEnv } from '@suluan/db/scripts/env.mjs'
import {
  auditEvents,
  decisions,
  notifications,
  outboxEvents,
  profiles,
  recordFiles,
  researchRecords,
  submissionFiles,
  submissions,
} from '@suluan/db/schema'
import { inArray } from 'drizzle-orm'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { createApp } from '../src/app'
import { createDb, type Db } from '../src/db'
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
  mintServiceToken: (claims?: Record<string, unknown>) => Promise<string>
  testEnv: () => Env
  authed: (
    path: string,
    token: string | null,
    extraHeaders?: Record<string, string>,
  ) => Response | Promise<Response>
  /** In-memory R2 stand-in: key -> stored bytes and content type. */
  r2objects: Map<
    string,
    { size: number; bytes: Uint8Array; contentType?: string }
  >
  /** Queue messages the app tried to send, in order. */
  sentMessages: unknown[]
}

export async function setupTestAuth(): Promise<TestAuth> {
  const pair = await generateKeyPair('RS256')
  const privateKey = pair.privateKey as JoseCryptoKey
  const jwk = await exportJWK(pair.publicKey)
  const jwks: JWTVerifyGetKey = createLocalJWKSet({
    keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
  })
  const app = createApp(() => ({ jwks, projectId: PROJECT_ID }), { jwks })
  const r2objects = new Map<
    string,
    { size: number; bytes: Uint8Array; contentType?: string }
  >()
  const sentMessages: unknown[] = []

  /** Read any supported R2 put value into bytes for the in-memory stand-in. */
  async function toBytes(
    value:
      ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
  ): Promise<Uint8Array> {
    if (value === null) return new Uint8Array(0)
    if (typeof value === 'string') return new TextEncoder().encode(value)
    if (value instanceof Blob) {
      return new Uint8Array(await value.arrayBuffer())
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    }
    const chunks: Uint8Array[] = []
    const reader = (
      value as ReadableStream<Uint8Array>
    ).getReader() as ReadableStreamDefaultReader<Uint8Array>
    for (;;) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      chunks.push(
        chunk instanceof Uint8Array
          ? chunk
          : new Uint8Array(chunk as ArrayBuffer),
      )
    }
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) {
      out.set(c, offset)
      offset += c.length
    }
    return out
  }

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

  async function mintServiceToken(claims: Record<string, unknown> = {}) {
    return new SignJWT({
      sub: 'processing-service-subject',
      email: 'suluan-processing@test-project.iam.gserviceaccount.com',
      email_verified: true,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer('https://accounts.google.com')
      .setAudience('https://api.test.suluan.example')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  }

  function testEnv(): Env {
    return {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      FIREBASE_PROJECT_ID: PROJECT_ID,
      ALLOWED_DOMAINS: 'ua.edu.ph',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      PROCESSING_SERVICE_AUDIENCE: 'https://api.test.suluan.example',
      PROCESSING_SERVICE_ACCOUNT:
        'suluan-processing@test-project.iam.gserviceaccount.com',
      DOCUMENTS: {
        head: async (key: string) => {
          const obj = r2objects.get(key)
          return obj ? { size: obj.size } : null
        },
        put: async (
          key: string,
          value:
            | ReadableStream
            | ArrayBuffer
            | ArrayBufferView
            | string
            | Blob
            | null,
          options?: { httpMetadata?: { contentType?: string } },
        ) => {
          const bytes = await toBytes(value)
          r2objects.set(key, {
            size: bytes.length,
            bytes,
            contentType: options?.httpMetadata?.contentType,
          })
          return { size: bytes.length }
        },
        get: async (key: string) => {
          const obj = r2objects.get(key)
          if (!obj) return null
          const bytes = obj.bytes
          return {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes)
                controller.close()
              },
            }),
            size: obj.size,
            contentType: obj.contentType,
          }
        },
        delete: async (key: string) => {
          r2objects.delete(key)
        },
      },
      NOTIFICATIONS: {
        send: async (message: unknown) => {
          sentMessages.push(message)
        },
      },
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

  return {
    app,
    privateKey,
    mintToken,
    mintServiceToken,
    testEnv,
    authed,
    r2objects,
    sentMessages,
  }
}

/** Insert a profile directly (role tests must not depend on the promote script). */
export async function insertProfile(
  db: Db,
  uid: string,
  email: string,
  role: 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN',
) {
  const [profile] = await db
    .insert(profiles)
    .values({ firebaseUid: uid, email, role })
    .returning()
  return profile
}

/**
 * Remove test submissions and everything reachable from them. Order
 * matters: text/FK references to submissions first, then repository links
 * (no cascade there), then intake rows (decisions/files cascade).
 */
export async function deleteSubmissions(db: Db, ids: string[]) {
  if (ids.length === 0) return
  await db.delete(notifications).where(inArray(notifications.submissionId, ids))
  await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, ids))
  const records = await db
    .select({ id: researchRecords.id })
    .from(researchRecords)
    .where(inArray(researchRecords.submissionId, ids))
  const recordIds = records.map((r) => r.id)
  if (recordIds.length > 0) {
    await db.delete(recordFiles).where(inArray(recordFiles.recordId, recordIds))
  }
  await db
    .delete(researchRecords)
    .where(inArray(researchRecords.submissionId, ids))
  await db.delete(decisions).where(inArray(decisions.submissionId, ids))
  await db
    .delete(submissionFiles)
    .where(inArray(submissionFiles.submissionId, ids))
  // Full-suite files run concurrently. A queue-consumer test can complete an
  // already-enqueued notification after the first delete above; close that
  // test-only race immediately before removing the parent submissions.
  await db.delete(notifications).where(inArray(notifications.submissionId, ids))
  await db.delete(submissions).where(inArray(submissions.id, ids))
}

export async function deleteProfiles(db: Db, uids: string[]) {
  if (uids.length === 0) return
  await db.delete(profiles).where(inArray(profiles.firebaseUid, uids))
}

/** Remove every submission (and its reachable rows) for the given submitter uids. */
export async function deleteSubmissionsForProfiles(db: Db, uids: string[]) {
  if (uids.length === 0) return
  const rows = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      inArray(
        submissions.submitterId,
        db
          .select({ id: profiles.id })
          .from(profiles)
          .where(inArray(profiles.firebaseUid, uids)),
      ),
    )
  const ids = rows.map((r) => r.id)
  await deleteSubmissions(db, ids)
  await deleteAuditEvents(db, ids, uids)
}

/** Audit rows reference both actors and entities — clear them before profiles. */
export async function deleteAuditEvents(
  db: Db,
  entityIds: string[],
  actorUids: string[],
) {
  if (entityIds.length > 0) {
    await db.delete(auditEvents).where(inArray(auditEvents.entityId, entityIds))
  }
  if (actorUids.length > 0) {
    await db
      .delete(auditEvents)
      .where(
        inArray(
          auditEvents.actorId,
          db
            .select({ id: profiles.id })
            .from(profiles)
            .where(inArray(profiles.firebaseUid, actorUids)),
        ),
      )
  }
}

/** Live Db handle for tests that arrange/assert rows directly. */
export function testDb(): Db {
  return createDb(process.env.DATABASE_URL!)
}

export { drizzle, neon }
