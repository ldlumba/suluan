/** Integration tests may only target an explicitly selected local test database.
 * A local proxy can still forward elsewhere: the operator must verify it is isolated.
 */
export function testDatabaseUrl(env) {
  const value = env.SULUAN_TEST_DATABASE_URL?.trim()
  if (!value) return undefined
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('SULUAN_TEST_DATABASE_URL must be a valid PostgreSQL URL.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^[a-zA-Z0-9_]+_test$/.test(url.pathname.slice(1))
  ) {
    throw new Error(
      'Database tests require a local isolated database with a name ending in _test. Remote targets are prohibited.',
    )
  }
  return value
}

export function configureTestDatabase(env) {
  const url = testDatabaseUrl(env)
  delete env.DATABASE_URL
  if (url) env.DATABASE_URL = url
}
