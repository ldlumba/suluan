import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root: two levels up from packages/db/scripts. */
export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

/**
 * Load the root `.env` if present. Uses only Node 22 builtins — no dotenv
 * dependency. Missing file is fine (CI / fresh clones); scripts that need
 * DATABASE_URL fail with an explicit message instead.
 */
export function loadRootEnv() {
  const envPath = path.join(repoRoot, '.env')
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
  return envPath
}

export function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and add the Neon ' +
        'development DIRECT endpoint (see Stage 1 guide in chat / AGENTS.md).',
    )
  }
  return url
}
