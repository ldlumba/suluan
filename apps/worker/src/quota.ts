import { sql } from 'drizzle-orm'
import type { Db } from './db'
import { viewerRoleFor, type ViewerRole } from './visibility'

/**
 * Server-side embedding quotas (owner-approved 2026-10-01).
 *
 * Two rules from the architecture are load-bearing here:
 * 1. Quotas/rate limits are enforced SERVER-SIDE BEFORE any paid work. So the
 *    counter is consumed first, and Gemini is only called on approval.
 * 2. Anonymous semantic search falls back to keyword search rather than
 *    failing. Every denial path here therefore returns a reason, and callers
 *    degrade instead of erroring.
 *
 * The approved "what is an op" answer: BOTH a request and an input are counted.
 * A request cap is the bug detector, because a retry storm multiplies requests;
 * an input cap is the real cost unit, because billing is per input token.
 */

export type QuotaBucket =
  /** Development safety net across indexing and querying, everyone. */
  | 'dev_global'
  /** Shared anonymous pool (production). */
  | 'anon_global'
  /** Shared authenticated pool (production). */
  | 'auth_global'
  /** Per signed-in profile (production). */
  | 'user'
  /** Production-only interactive Semantic Search pool. */
  | 'semantic_global'
  /** Production-only Assistant retrieval pool. */
  | 'assistant_retrieval_global'

export interface QuotaLimits {
  /** Maximum API requests per UTC day. */
  maxRequests: number
  /** Maximum embedded inputs (chunks or queries) per UTC day. */
  maxInputs: number
}

/**
 * Development cap: 20 requests AND 2,000 inputs per day. Requests catch retry
 * storms while inputs bound paid work. A temporary 40-request evaluation window
 * was completed and reverted on 2026-10-02.
 */
export const DEV_LIMITS: QuotaLimits = { maxRequests: 20, maxInputs: 2000 }

/**
 * Resolve temporary environment overrides for a controlled evaluation window.
 * Invalid values fail safe to the normal development limits. The hard ceilings
 * remain code-owned so a deployment cannot accidentally create an unbounded
 * paid-work budget.
 */
export function embeddingLimits(
  rawRequests: string | undefined,
  rawInputs?: string,
): QuotaLimits {
  const maxRequests =
    rawRequests && /^\d+$/.test(rawRequests)
      ? Number(rawRequests)
      : DEV_LIMITS.maxRequests
  const maxInputs =
    rawInputs && /^\d+$/.test(rawInputs)
      ? Number(rawInputs)
      : DEV_LIMITS.maxInputs
  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    !Number.isSafeInteger(maxInputs) ||
    maxInputs < 1
  )
    return DEV_LIMITS
  return {
    maxRequests: Math.min(maxRequests, 200),
    maxInputs: Math.min(maxInputs, 4000),
  }
}

/** Approved production query-side limits, applied to search calls only. */
export const QUERY_LIMITS: Record<'anonymous' | 'authenticated', QuotaLimits> =
  {
    anonymous: { maxRequests: 20, maxInputs: 20 },
    authenticated: { maxRequests: 50, maxInputs: 50 },
  }

const MAX_INTERACTIVE_REQUESTS_PER_DAY = 1000

/** Parse a request-only interactive limit with a code-owned hard ceiling. */
export function interactiveLimits(
  raw: string | undefined,
  fallback: number,
): QuotaLimits {
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : fallback
  const maxRequests =
    Number.isSafeInteger(parsed) && parsed > 0
      ? Math.min(parsed, MAX_INTERACTIVE_REQUESTS_PER_DAY)
      : fallback
  return { maxRequests, maxInputs: maxRequests }
}

export interface QueryQuotaPolicy {
  globalBucket: QuotaBucket
  global: QuotaLimits
  authenticatedUser: QuotaLimits
}

/**
 * Unset production values deliberately retain the legacy shared staging pool.
 * Production gets a separate semantic bucket so corpus embedding and Assistant
 * retrieval cannot unexpectedly consume interactive search capacity.
 */
export function queryQuotaPolicy(
  rawGlobal: string | undefined,
  rawUser: string | undefined,
  sharedFallback: QuotaLimits = DEV_LIMITS,
): QueryQuotaPolicy {
  if (!rawGlobal && !rawUser) {
    return {
      globalBucket: 'dev_global',
      global: sharedFallback,
      authenticatedUser: QUERY_LIMITS.authenticated,
    }
  }
  return {
    globalBucket: 'semantic_global',
    global: interactiveLimits(rawGlobal, 500),
    authenticatedUser: interactiveLimits(rawUser, 10),
  }
}

export interface QuotaResult {
  allowed: boolean
  reason?: string
  used: { requests: number; inputs: number }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Atomically consume quota, returning allowed=false when the limit would be
 * exceeded. Single-statement upsert with a guard in the DO UPDATE: neon-http
 * has no interactive transactions, so atomicity must come from one statement.
 *
 * The guard lives only on the conflict path, which is correct: the insert path
 * can only fire for a bucket/day that has no row yet, so its first request is
 * trivially within any positive limit. Concurrent first-writers resolve through
 * the guarded conflict path. A denial returns zero rows and consumes nothing,
 * so a burst of rejected requests cannot itself exhaust the budget.
 */
export async function consumeQuota(
  db: Db,
  bucket: QuotaBucket,
  actorKey: string,
  requests: number,
  inputs: number,
  limits: QuotaLimits,
): Promise<QuotaResult> {
  const result = await db.execute(sql`
    insert into embedding_usage (bucket, actor_key, day, requests, inputs)
    values (${bucket}, ${actorKey}, ${today()}, ${requests}, ${inputs})
    on conflict (bucket, actor_key, day) do update
      set requests = embedding_usage.requests + ${requests},
          inputs = embedding_usage.inputs + ${inputs}
      where embedding_usage.requests + ${requests} <= ${limits.maxRequests}
        and embedding_usage.inputs + ${inputs} <= ${limits.maxInputs}
    returning requests, inputs
  `)
  if (result.rows.length === 0) {
    const current = await readUsage(db, bucket, actorKey)
    return {
      allowed: false,
      reason:
        `daily embedding limit reached (${limits.maxRequests} requests / ` +
        `${limits.maxInputs} inputs)`,
      used: current,
    }
  }
  const row = result.rows[0] as { requests: number; inputs: number }
  return {
    allowed: true,
    used: { requests: Number(row.requests), inputs: Number(row.inputs) },
  }
}

async function readUsage(
  db: Db,
  bucket: QuotaBucket,
  actorKey: string,
): Promise<{ requests: number; inputs: number }> {
  const result = await db.execute(sql`
    select requests, inputs from embedding_usage
    where bucket = ${bucket} and actor_key = ${actorKey} and day = ${today()}
  `)
  if (result.rows.length === 0) return { requests: 0, inputs: 0 }
  const row = result.rows[0] as { requests: number; inputs: number }
  return { requests: Number(row.requests), inputs: Number(row.inputs) }
}

export interface QueryQuotaRequest {
  viewer: ViewerRole
  /** Profile id, or null for anonymous. */
  profileId: string | null
}

/**
 * Consume the dev safety cap plus the applicable per-actor query quota.
 *
 * Anonymous callers are NOT given a personal per-day counter in dev, by design
 * (see the `embedding_usage` schema note). They are bounded by the shared
 * buckets, which fail closed to keyword search.
 */
export async function consumeQueryQuota(
  db: Db,
  request: QueryQuotaRequest,
  policy: QueryQuotaPolicy = queryQuotaPolicy(undefined, undefined),
): Promise<QuotaResult> {
  const global = await consumeQuota(
    db,
    policy.globalBucket,
    'all',
    1,
    1,
    policy.global,
  )
  if (!global.allowed) return global

  if (request.viewer === 'PUBLIC') {
    return consumeQuota(db, 'anon_global', 'all', 1, 1, QUERY_LIMITS.anonymous)
  }
  if (request.profileId) {
    return consumeQuota(
      db,
      'user',
      request.profileId,
      1,
      1,
      policy.authenticatedUser,
    )
  }
  return {
    allowed: false,
    reason: 'authenticated profile required',
    used: global.used,
  }
}

export function viewerFromProfile(
  role: 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN' | null | undefined,
): ViewerRole {
  return viewerRoleFor(role ?? null)
}
