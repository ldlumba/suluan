import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import {
  cacheControlFor,
  effectiveVisibility,
  viewerRoleFor,
  visibilityLabel,
} from '../src/visibility'

const dialect = new PgDialect()

/** Render a fragment to SQL, normalized so assertions ignore template spacing. */
function text(sql: SQL): string {
  return dialect
    .sqlToQuery(sql)
    .sql.replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
}

/**
 * Unit coverage for the visibility policy helpers. The SQL fragments they emit
 * are exercised end-to-end in visibility.test.ts.
 */
describe('viewerRoleFor', () => {
  it('maps roles to viewer levels, defaulting to anonymous', () => {
    expect(viewerRoleFor('ADMIN')).toBe('MANAGER')
    expect(viewerRoleFor('REPOSITORY_MANAGER')).toBe('MANAGER')
    expect(viewerRoleFor('USER')).toBe('UA_USER')
    expect(viewerRoleFor(null)).toBe('PUBLIC')
    expect(viewerRoleFor(undefined)).toBe('PUBLIC')
  })
})

describe('effectiveVisibility', () => {
  const fragments = (viewer: 'PUBLIC' | 'UA_USER' | 'MANAGER') =>
    JSON.stringify(effectiveVisibility(viewer, 'r').rowVisible.queryChunks)

  it('gives managers an unconditional pass', () => {
    expect(fragments('MANAGER')).toContain('true')
  })

  it('keeps RESTRICTED away from UA users unless an embargo elapsed', () => {
    const sql = fragments('UA_USER')
    expect(sql).toContain('RESTRICTED')
    expect(sql).toContain('embargo_until')
  })

  it('parenthesizes embargo fragments and matches the effective level', () => {
    // Regression guards:
    // 1. Unparenthesized, `not a is not null and a > x` binds as
    //    `not (a is not null) and ...`, and the NULL propagates to exclude
    //    every record instead of including it.
    // 2. The anonymous predicate must consider an ELAPSED embargo on a
    //    restricted record, or auto-lift never becomes publicly visible.
    expect(text(effectiveVisibility('PUBLIC', 'r').rowVisible)).toBe(
      `((r.visibility = 'PUBLIC' and not (r.embargo_until is not null and r.embargo_until > current_date)) or (r.visibility <> 'PUBLIC' and (r.embargo_until is not null and r.embargo_until <= current_date)))`,
    )
    expect(text(effectiveVisibility('UA_USER', 'r').rowVisible)).toBe(
      `(r.visibility <> 'RESTRICTED' or (r.embargo_until is not null and r.embargo_until <= current_date))`,
    )
  })

  it('restricts anonymous viewers to unembargoed PUBLIC records', () => {
    const sql = fragments('PUBLIC')
    expect(sql).toContain('PUBLIC')
    expect(sql).toContain('embargo_until')
  })
})

describe('visibilityLabel', () => {
  it('labels each level for the UI', () => {
    expect(visibilityLabel('PUBLIC')).toBe('Public')
    expect(visibilityLabel('UA_ONLY')).toMatch(/university/i)
    expect(visibilityLabel('RESTRICTED')).toMatch(/manager/i)
  })
})

describe('cacheControlFor', () => {
  it('caches only truly anonymous responses', () => {
    expect(cacheControlFor('PUBLIC', false, 30)).toBe('public, max-age=30')
    expect(cacheControlFor('PUBLIC', false, 300)).toBe('public, max-age=300')
  })

  it('never stores authenticated responses', () => {
    expect(cacheControlFor('UA_USER', false, 30)).toBe('private, no-store')
    expect(cacheControlFor('MANAGER', false, 30)).toBe('private, no-store')
  })

  it('never stores responses to unverifiable credentials', () => {
    // Regression guard: optionalAuth degrades a stale/invalid token to the
    // anonymous body, but a shared cache keyed by URL must not store that
    // response as the canonical anonymous one.
    expect(cacheControlFor('PUBLIC', true, 30)).toBe('private, no-store')
    expect(cacheControlFor('PUBLIC', true, 300)).toBe('private, no-store')
  })
})
