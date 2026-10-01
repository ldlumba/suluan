import { loadRootEnv, requireDatabaseUrl } from './env.mjs'

/**
 * DEV ONLY. Inserts clearly-labeled SAMPLE catalog rows so the submission
 * form's school/course selects are testable locally. Real catalog contents
 * are TBD (Architecture v1 §10) — these rows are placeholders, not policy.
 * Safe to rerun (ON CONFLICT DO NOTHING). Never run against production.
 *
 * Usage: npm run seed:dev -w @suluan/db
 */
loadRootEnv()
const connectionString = requireDatabaseUrl()

const { Client } = await import('pg')
const client = new Client({ connectionString })
await client.connect()
try {
  const { rows: schools } = await client.query(`
    insert into schools (name) values
      ('[SAMPLE] School of Engineering'),
      ('[SAMPLE] School of Arts and Sciences')
    on conflict (name) do nothing
    returning id, name
  `)
  for (const school of schools) {
    const suffix = school.name.includes('Engineering')
      ? ['BS Computer Engineering', 'BS Civil Engineering']
      : ['BA Communication', 'BS Psychology']
    for (const course of suffix) {
      await client.query(
        `insert into courses (school_id, name)
         select $1, $2
         where not exists (
           select 1 from courses where school_id = $1 and name = $2
         )`,
        [school.id, `[SAMPLE] ${course}`],
      )
    }
  }
  const { rows } = await client.query('select count(*)::int as n from schools')
  console.log(`seed:dev complete (${rows[0].n} schools total)`)
} finally {
  await client.end()
}
