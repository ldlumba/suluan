import { Client } from 'pg'
import { loadRootEnv, requireDatabaseUrl } from './env.mjs'

loadRootEnv()
const connectionString = requireDatabaseUrl()

const expectedTables = [
  // identity
  'profiles',
  'schools',
  'courses',
  // intake
  'submissions',
  'submission_files',
  'decisions',
  // repository
  'research_records',
  'record_files',
  'record_authors',
  // operations
  'audit_events',
  'outbox_events',
  'notifications',
  'processing_jobs',
  'keyword_indexes',
  'document_chunks',
]

/** Drizzle bookkeeping lives in its own schema in current drizzle-orm. */
const expectedDrizzleTables = ['drizzle.__drizzle_migrations']

const expectedEnums = {
  role: ['USER', 'REPOSITORY_MANAGER', 'ADMIN'],
  submission_status: ['PENDING', 'ACCEPTED', 'REJECTED'],
  notification_status: ['PENDING', 'SENT', 'SKIPPED', 'FAILED'],
  extraction_status: ['QUEUED', 'PROCESSING', 'EXTRACTED', 'FAILED'],
}

const failures = []
const client = new Client({ connectionString })
await client.connect()
try {
  const { rows: vector } = await client.query(
    "select extname from pg_extension where extname = 'vector'",
  )
  if (vector.length) console.log('ok   extension vector')
  else failures.push('extension vector missing')
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public'`,
  )
  const present = new Set(tables.map((r) => r.table_name))
  for (const t of expectedTables) {
    if (present.has(t)) {
      console.log(`ok   table ${t}`)
    } else {
      console.log(`FAIL table ${t} missing`)
      failures.push(`table ${t}`)
    }
  }

  const { rows: drizzleTables } = await client.query(
    `select table_schema || '.' || table_name as qualified
     from information_schema.tables
     where table_schema = 'drizzle'`,
  )
  const drizzlePresent = new Set(drizzleTables.map((r) => r.qualified))
  for (const t of expectedDrizzleTables) {
    if (drizzlePresent.has(t)) {
      console.log(`ok   table ${t}`)
    } else {
      console.log(`FAIL table ${t} missing`)
      failures.push(`table ${t}`)
    }
  }

  for (const [name, labels] of Object.entries(expectedEnums)) {
    const { rows } = await client.query(
      `select e.enumlabel from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = $1 order by e.enumsortorder`,
      [name],
    )
    const actual = rows.map((r) => r.enumlabel)
    if (JSON.stringify(actual) === JSON.stringify(labels)) {
      console.log(`ok   enum ${name} = [${actual.join(', ')}]`)
    } else {
      console.log(
        `FAIL enum ${name}: expected [${labels.join(', ')}], got [${actual.join(', ')}]`,
      )
      failures.push(`enum ${name}`)
    }
  }

  // Locked rule: remarks required before either decision.
  const { rows: remarks } = await client.query(
    `select is_nullable from information_schema.columns
     where table_name = 'decisions' and column_name = 'remarks'`,
  )
  if (remarks[0]?.is_nullable === 'NO') {
    console.log('ok   decisions.remarks is NOT NULL')
  } else {
    console.log('FAIL decisions.remarks must be NOT NULL')
    failures.push('decisions.remarks nullable')
  }
} finally {
  await client.end()
}

if (failures.length > 0) {
  console.error(`\ndb:check failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('\ndb:check passed')
