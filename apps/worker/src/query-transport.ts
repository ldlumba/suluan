import { sql } from 'drizzle-orm'
import type { Db } from './db'
import { EMBEDDING_DIMS, EmbeddingError, normalizeVector } from './embeddings'

export function queryServiceUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.run.app') ||
      url.username || url.password || url.search || url.hash || url.port ||
      url.pathname !== '/') throw new Error('Invalid regional service origin')
  return `${url.origin}/embed`
}

/** Called only after Worker quota reservation. No query text is persisted. */
export async function regionalQueryVector(db: Db, origin: string, query: string): Promise<number[]> {
  const endpoint = queryServiceUrl(origin)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query))
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const ticket = crypto.randomUUID()
  await db.execute(sql`
    insert into embedding_claims (claim_token, kind, inputs, payload, expires_at)
    values (${ticket}, 'query', 1,
      ${JSON.stringify({ transport: 'interactive-v1', sha256 })}::jsonb,
      now() + interval '60 seconds')
  `)
  try {
    // Cloudflare Workers reject the browser-style timeout/redirect options in
    // this runtime. The fixed allowlisted origin and Cloud Run's 60s request
    // timeout bound this subrequest without a client-controlled destination.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, query }),
    })
    if (!response.ok) throw new EmbeddingError('Regional embedding unavailable', response.status)
    const payload = await response.json() as { values?: unknown }
    const values = payload.values
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS ||
        values.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
        !values.some((v) => v !== 0)) throw new EmbeddingError('Invalid regional vector', 0)
    return normalizeVector(values)
  } finally {
    // Invalidate an unredeemed ticket even when transport fails. Never refund quota.
    await db.execute(sql`update embedding_claims set used_at = coalesce(used_at, now())
      where claim_token = ${ticket}`)
  }
}
