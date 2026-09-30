export interface Env {
  DATABASE_URL: string
  FIREBASE_PROJECT_ID: string
  ALLOWED_DOMAINS: string
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
