import { loadRootEnv, requireDatabaseUrl } from './env.mjs'

/**
 * Compatibility command retained for existing developer workflows. The real
 * catalog is migration-owned as of migration 0008, so this command verifies
 * that it exists and never inserts SAMPLE rows.
 */
loadRootEnv()
const connectionString = requireDatabaseUrl()

const { Client } = await import('pg')
const client = new Client({ connectionString })
await client.connect()
try {
  const { rows } = await client.query(`
    select count(distinct s.id)::int as schools, count(c.id)::int as courses
    from schools s join courses c on c.school_id = s.id
    where s.name in (
      'School of Health, Arts and Sciences',
      'School of Education',
      'School of Business',
      'School of Technological Studies'
    )
  `)
  if (rows[0].schools !== 4 || rows[0].courses !== 28) {
    throw new Error(
      'Catalog migrations are not fully applied (expected 4 schools / 28 courses)',
    )
  }
  console.log(
    'seed:dev complete (catalog supplied by migrations 0008 and 0021)',
  )
} finally {
  await client.end()
}
