/**
 * Structural R2 binding surface. Declared locally instead of importing
 * @cloudflare/workers-types: the Worker only needs these members, and
 * structural typing keeps the dependency footprint minimal. The real
 * runtime binding satisfies this interface.
 *
 * NOTE: R2 bindings have no presigned-URL API — the browser never talks
 * to R2 directly. Uploads arrive as multipart bodies the Worker streams
 * into R2; downloads stream back through the Worker after authorization.
 */
export interface R2ObjectHead {
  size: number
}

export interface R2ObjectBodyLike {
  body: ReadableStream
  size: number
  contentType?: string
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectHead | null>
  put(
    key: string,
    value:
      ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2ObjectHead>
  get(key: string): Promise<R2ObjectBodyLike | null>
  delete(key: string): Promise<void>
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
  /**
   * Gemini API key, server-side only. Never expose to the browser and never
   * commit: local runs read `apps/worker/.dev.vars` (git-ignored), deployment
   * would use a Wrangler secret. Current AI Studio keys use the `AQ.` auth-key
   * format and are bound to a service account; older `AIza` traffic keys were
   * rejected by the API from September 2026.
   *
   * Optional so a credential-less clone stays green: with no key, semantic
   * endpoints degrade to keyword results instead of failing.
   */
  GEMINI_API_KEY?: string
  /**
   * Optional environment-specific caps for the shared embedding quota. Values
   * are parsed and clamped server-side; temporary staging overrides must be
   * removed immediately after the governed evaluation.
   */
  EMBEDDING_DAILY_REQUEST_LIMIT?: string
  EMBEDDING_DAILY_INPUT_LIMIT?: string
  /** Production interactive semantic quotas; unset preserves the staging pool. */
  SEMANTIC_DAILY_REQUEST_LIMIT?: string
  SEMANTIC_USER_DAILY_REQUEST_LIMIT?: string
  /** Retrieval mode; staging uses guarded hybrid after owner approval 2026-10-13. */
  SEMANTIC_SEARCH_MODE?: 'semantic' | 'hybrid'
  /** Candidate record scorer; the length penalty remains evaluation-only by default. */
  SEMANTIC_SCORING_MODE?: 'top_k_mean' | 'log_length_penalized_min'
  /** Optional evaluated score ceiling. Invalid configuration fails closed. */
  SEMANTIC_MAX_SCORE?: string
  /** Optional staging discovery band; results beyond MAX_SCORE are labeled exploratory. */
  SEMANTIC_DISCOVERY_MAX_SCORE?: string
  /** Regional query-only service; enabling remains gated on launch review. */
  QUERY_EMBEDDING_URL?: string
  QUERY_SERVICE_ACCOUNT?: string
  QUERY_SERVICE_AUDIENCE?: string
  /** First rollout is UA-authenticated only; public semantic limits remain TBD. */
  SEMANTIC_AUTHENTICATED_ONLY?: 'true'
  /** Separate regional read-only assistant; unset means disabled. */
  ASSISTANT_SERVICE_URL?: string
  ASSISTANT_SERVICE_ACCOUNT?: string
  ASSISTANT_SERVICE_AUDIENCE?: string
  /** Pilot is fail-safe default; production may authorize every verified UA profile. */
  ASSISTANT_ACCESS_MODE?: 'pilot' | 'all_authenticated'
  /** Owner-confirmed eligible adult pilot emails. Missing/empty denies all. */
  ASSISTANT_PILOT_EMAILS?: string
  /** Separate production retrieval pool; unset keeps the shared staging pool. */
  ASSISTANT_RETRIEVAL_DAILY_REQUEST_LIMIT?: string
  /** Exact audience requested from the Cloud Run metadata identity endpoint. */
  PROCESSING_SERVICE_AUDIENCE?: string
  /** Exact dedicated Cloud Run Job service-account email. */
  PROCESSING_SERVICE_ACCOUNT?: string
  /** Ticket dispatcher for manager-started bounded Cloud Run Jobs. */
  OPERATIONS_DISPATCHER_URL?: string
  OPERATIONS_SERVICE_ACCOUNT?: string
  /** Test/dev REO recipient. Unset until the mailbox decision lands. */
  REO_MAILBOX?: string
  /**
   * Contact email sent to Crossref (polite pool User-Agent/mailto). Falls
   * back to REO_MAILBOX when unset; DOI enrichment never requires it.
   */
  DOI_CONTACT_EMAIL?: string
  /**
   * Gmail sender (owner-approved 2026-10-05, temporary UA mailbox).
   * Server-side only, via `wrangler secret put` — never commit, never expose
   * to the browser. When any of the four is missing, delivery falls back to
   * the log adapter instead of failing. GMAIL_SENDER is the authorized UA
   * mailbox used as the MIME From address; swapping the sender later means
   * re-authorizing OAuth for the new mailbox, not a code change.
   */
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
  GMAIL_SENDER?: string
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
