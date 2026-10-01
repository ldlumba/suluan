/**
 * Structural R2 binding surface. Declared locally instead of importing
 * @cloudflare/workers-types: the Worker only needs these three members,
 * and structural typing keeps the dependency footprint minimal. The real
 * runtime binding satisfies this interface.
 */
export interface R2BucketLike {
  head(key: string): Promise<{ size: number } | null>
  createPresignedUrl(opts: {
    method: 'put' | 'get'
    key: string
    expiration?: number
  }): Promise<string>
}

/** Structural queue-producer surface (see R2BucketLike rationale). */
export interface QueueLike {
  send(message: unknown): Promise<void>
}

export interface Env {
  DATABASE_URL: string
  FIREBASE_PROJECT_ID: string
  ALLOWED_DOMAINS: string
  /**
   * Comma-separated exact origins allowed to call the API from browsers
   * (e.g. "http://localhost:5173"). Production value is set at deploy time;
   * never "*" — the API carries Authorization headers and must not accept
   * arbitrary origins.
   */
  ALLOWED_ORIGINS: string
  DOCUMENTS: R2BucketLike
  NOTIFICATIONS: QueueLike
  /** Test/dev REO recipient. Unset until the mailbox decision lands. */
  REO_MAILBOX?: string
}

/** Structural queue-consumer message (see R2BucketLike rationale). */
export interface QueueMessageLike<T> {
  body: T
  ack(): void
  retry(): void
}

/**
 * LOCKED identity rule (Architecture v1 §12, 2026-09-30): only the listed
 * Google Workspace domains may sign in. Comparison is case-insensitive and
 * exact — no subdomain matching. Extending the list needs a dated amendment.
 */
export function isAllowedDomain(
  email: string,
  allowedDomains: string,
): boolean {
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const domain = email.slice(at + 1).toLowerCase()
  return allowedDomains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .includes(domain)
}

/** Parse the CORS origin allowlist. Matching is exact — no wildcards. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}
