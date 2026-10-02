import { defineConfig } from 'vitest/config'

/** Worker integration tests use the remote Neon development database. */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
