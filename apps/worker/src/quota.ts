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

export interface QuotaLimits {
  /** Maximum API requests per UTC day. */
  maxRequests: number
  /** Maximum embedded inputs (chunks or queries) per UTC day. */
  maxInputs: number
}

/**
 * Temporary relevance-evaluation cap: 40 requests AND 2,000 inputs per day.
 * The request cap was raised from 20 only for the labeled 15-paper corpus run;
 * it remains far below the observed provider RPD limit and the input cap still
 * bounds paid work. Restore 20 requests after relevance evaluation finishes.
 */
export const DEV_LIMITS: QuotaLimits = { maxRequests: 40, maxInputs: 2000 }

/** Approved production query-side limits, applied to search calls only. */
export const QUERY_LIMITS: Record<'anonymous' | 'authenticated', QuotaLimits> = {
  anonymous: { maxRequests: 20, maxInputs: 20 },
  authenticated: { maxRequests: 50, maxInputs: 50 },
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
  return { allowed: true, used: { requests: Number(row.requests), inputs: Number(row.inputs) } }
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
): Promise<QuotaResult> {
  const dev = await consumeQuota(db, 'dev_global', 'all', 1, 1, DEV_LIMITS)
  if (!dev.allowed) return dev

  if (request.viewer === 'PUBLIC') {
    return consumeQuota(
      db,
      'anon_global',
      'all',
      1,
      1,
      QUERY_LIMITS.anonymous,
    )
  }
  if (request.viewer === 'UA_USER' && request.profileId) {
    return consumeQuota(
      db,
      'user',
      request.profileId,
      1,
      1,
      QUERY_LIMITS.authenticated,
    )
  }
  // Managers share the authenticated pool.
  return consumeQuota(
    db,
    'auth_global',
    'all',
    1,
    1,
    QUERY_LIMITS.authenticated,
  )
}

export function viewerFromProfile(
  role: 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN' | null | undefined,
): ViewerRole {
  return viewerRoleFor(role ?? null)
}
