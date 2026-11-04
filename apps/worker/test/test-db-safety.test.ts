import { describe, expect, it } from 'vitest'
import {
  configureTestDatabase,
  testDatabaseUrl,
} from '../../../packages/db/scripts/test-db-safety.mjs'

describe('database integration test safeguards', () => {
  it('ignores a regular database URL when no isolated test target is configured', () => {
    const env = {
      DATABASE_URL: 'postgresql://user:password@production.example/db',
    }
    configureTestDatabase(env)
    expect(env.DATABASE_URL).toBeUndefined()
  })
  it('rejects remote hosts and non-test database names', () => {
    expect(() =>
      testDatabaseUrl({
        SULUAN_TEST_DATABASE_URL:
          'postgresql://user:password@production.example/app_test',
      }),
    ).toThrow()
    expect(() =>
      testDatabaseUrl({
        SULUAN_TEST_DATABASE_URL:
          'postgresql://user:password@localhost/production',
      }),
    ).toThrow()
  })
  it('accepts an explicitly selected local test database', () => {
    expect(
      testDatabaseUrl({
        SULUAN_TEST_DATABASE_URL:
          'postgresql://user:password@localhost/suluan_test',
      }),
    ).toContain('/suluan_test')
  })
})
