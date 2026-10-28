import { sql, type SQL } from 'drizzle-orm'

/** Viewer levels: anonymous visitor, signed-in UA account, or manager. */
export type ViewerRole = 'PUBLIC' | 'UA_USER' | 'MANAGER'

/**
 * Effective record visibility for one viewer level (owner-approved
 * 2026-10-01). Kept separate from the query builders so the policy is
 * testable and reviewable in one place:
 *
 * - PUBLIC is public, unless an embargo date is still in the future, in which
 *   case it degrades to UA_ONLY (an embargoed paper is not published yet).
 * - UA_ONLY and RESTRICTED stay as set until an elapsed embargo lifts them to
 *   PUBLIC.
 * - Managers bypass every filter by role, never by record.
 */

/** Map a signed-in UA profile role onto a viewer level. */
export function viewerRoleFor(
  role: 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN' | null | undefined,
): ViewerRole {
  if (role === 'REPOSITORY_MANAGER' || role === 'ADMIN') return 'MANAGER'
  if (role === 'USER') return 'UA_USER'
  return 'PUBLIC'
}

/** Human-readable label for the UI; mirrors the SQL case expression. */
export function visibilityLabel(level: string): string {
  if (level === 'PUBLIC') return 'Public'
  if (level === 'UA_ONLY') return 'University access only'
  return 'Repository managers only'
}

/**
 * Cache policy for visibility-filtered reads. Anonymous responses (no
 * credential was offered) are identical for everyone and short-lived
 * cacheable; everything else must never be stored. In particular, a request
 * that bore an `Authorization` header but failed verification still degrades
 * to the anonymous body — yet a shared cache keyed by URL must not store
 * that response as the canonical anonymous one.
 */
export function cacheControlFor(
  viewer: ViewerRole,
  authAttempted: boolean,
  maxAgeSeconds: number,
): string {
  return viewer === 'PUBLIC' && !authAttempted
    ? `public, max-age=${maxAgeSeconds}`
    : 'private, no-store'
}

/**
 * Row-level predicate for a viewer, parameterized by table alias so callers
 * can compose it into their own query. Mirrors visibilityCase(): an embargo in
 * the future degrades PUBLIC to UA_ONLY, an elapsed embargo lifts restrictions.
 */
export function effectiveVisibility(
  viewer: ViewerRole,
  table: string,
): { rowVisible: SQL } {
  const t = (column: string) => sql.raw(`${table}.${column}`)
  // Each fragment MUST be parenthesized: `not a is not null and ...` parses as
  // `not (a is not null) and ...`, and with a NULL date the AND yields NULL,
  // which silently excludes every row instead of including it.
  const embargoed = sql`(${t('embargo_until')} is not null and ${t('embargo_until')} > current_date)`
  const elapsed = sql`(${t('embargo_until')} is not null and ${t('embargo_until')} <= current_date)`
  if (viewer === 'MANAGER') return { rowVisible: sql`true` }
  if (viewer === 'UA_USER') {
    return {
      rowVisible: sql`(${t('visibility')} <> 'RESTRICTED' or ${elapsed})`,
    }
  }
  // Match on the EFFECTIVE level, not the stored column: an elapsed embargo
  // lifts UA_ONLY/RESTRICTED to public, so those rows must become visible here.
  return {
    rowVisible: sql`((${t('visibility')} = 'PUBLIC' and not ${embargoed}) or (
      ${t('visibility')} <> 'PUBLIC' and ${elapsed}
    ))`,
  }
}

/**
 * Case expression yielding the effective level, for labeling results so the
 * UI never has to re-derive the embargo rule.
 */
export function effectiveVisibilityLevel(table: string): SQL {
  const t = (column: string) => sql.raw(`${table}.${column}`)
  return sql`case
    when ${t('visibility')} = 'PUBLIC'
      and ${t('embargo_until')} is not null
      and ${t('embargo_until')} > current_date then 'UA_ONLY'
    when ${t('visibility')} <> 'PUBLIC'
      and ${t('embargo_until')} is not null
      and ${t('embargo_until')} <= current_date then 'PUBLIC'
    else ${t('visibility')} end`
}
