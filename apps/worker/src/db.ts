import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '@suluan/db/schema'

/**
 * Workers have no TCP Postgres access, so the Worker reaches Neon over HTTP.
 * One client per request is the intended serverless pattern for neon-http
 * (no connection pool exists to hold — each query is a fetch call).
 */
export function createDb(connectionString: string) {
  return drizzle(neon(connectionString), { schema })
}

export type Db = ReturnType<typeof createDb>
