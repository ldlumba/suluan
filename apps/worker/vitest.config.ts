import { defineConfig } from 'vitest/config'
import { configureTestDatabase } from '../../packages/db/scripts/test-db-safety.mjs'

configureTestDatabase(process.env)

/** Database tests require an explicitly configured isolated local test database. */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
