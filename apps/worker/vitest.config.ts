import { defineConfig } from 'vitest/config'

/** Database integration tests run only when an explicit DATABASE_URL is supplied. */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
