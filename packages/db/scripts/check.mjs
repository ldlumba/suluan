import { Client } from 'pg'
import { loadRootEnv, requireDatabaseUrl } from './env.mjs'

loadRootEnv()
const connectionString = requireDatabaseUrl()

const expectedTables = [
  // identity
  'profiles',
  'role_management_state',
  'schools',
  'courses',
  // intake
  'submissions',
  'submission_files',
  'submission_keywords',
  'decisions',
  // repository
  'research_records',
  'record_files',
  'record_authors',
  'keywords',
  'research_keywords',
  // operations
  'audit_events',
  'outbox_events',
  'notifications',
  'processing_jobs',
  'keyword_indexes',
  'document_chunks',
  'semantic_indexes',
  'document_embeddings',
  'embedding_usage',
  'embedding_claims',
  'assistant_sessions',
  'assistant_requests',
  'assistant_usage',
]

/** Drizzle bookkeeping lives in its own schema in current drizzle-orm. */
const expectedDrizzleTables = ['drizzle.__drizzle_migrations']

const expectedEnums = {
  role: ['USER', 'REPOSITORY_MANAGER', 'ADMIN'],
  submission_status: ['PENDING', 'ACCEPTED', 'REJECTED'],
  notification_status: ['PENDING', 'SENT', 'SKIPPED', 'FAILED'],
  extraction_status: ['QUEUED', 'PROCESSING', 'EXTRACTED', 'FAILED'],
  record_visibility: ['PUBLIC', 'UA_ONLY', 'RESTRICTED'],
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

  // Embedding geometry is part of the approved design: vectors of different
  // widths are not comparable, so the stored column width must match.
  const { rows: dims } = await client.query(
    `select a.atttypmod as width
     from pg_attribute a join pg_class c on c.oid = a.attrelid
     where c.relname = 'document_embeddings'
       and a.attname = 'embedding'`,
  )
  if (Number(dims[0]?.width) === 768) {
    console.log('ok   document_embeddings.embedding is vector(768)')
  } else {
    console.log(
      `FAIL document_embeddings.embedding is vector(${dims[0]?.width}), expected 768`,
    )
    failures.push('document_embeddings.embedding width')
  }

  // Embed-once is a storage-level guarantee, not just application logic.
  const { rows: uniq } = await client.query(
    `select count(*)::int as n from pg_constraint
     where conrelid = 'document_embeddings'::regclass
       and contype = 'u' and pg_get_constraintdef(oid) like '%chunk_id%'`,
  )
  if (uniq[0]?.n > 0) {
    console.log('ok   document_embeddings UNIQUE(chunk_id)')
  } else {
    console.log('FAIL document_embeddings missing UNIQUE(chunk_id)')
    failures.push('document_embeddings unique chunk_id')
  }

  // A frozen evaluation is one paid batch. Even if two operators start the
  // dedicated Job together, PostgreSQL must arbitrate a single active claim.
  const { rows: evaluationLock } = await client.query(
    `select count(*)::int as n from pg_indexes
     where schemaname = current_schema()
       and indexname = 'embedding_claims_active_evaluation_unique'
       and indexdef like '%UNIQUE%'
       and indexdef like '%evaluation%'`,
  )
  if (evaluationLock[0]?.n === 1) {
    console.log('ok   one active semantic evaluation claim')
  } else {
    console.log('FAIL embedding_claims missing active evaluation guard')
    failures.push('embedding_claims active evaluation guard')
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

  const { rows: recordYear } = await client.query(
    `select data_type, is_nullable from information_schema.columns
     where table_name = 'research_records' and column_name = 'year'`,
  )
  if (
    recordYear[0]?.data_type === 'integer' &&
    recordYear[0]?.is_nullable === 'NO'
  ) {
    console.log('ok   research_records.year is integer NOT NULL')
  } else {
    console.log('FAIL research_records.year must be integer NOT NULL')
    failures.push('research_records.year')
  }

  const { rows: catalog } = await client.query(
    `select count(distinct s.id)::int as schools, count(c.id)::int as courses
     from schools s join courses c on c.school_id = s.id
     where s.name in (
       'School of Health, Arts and Sciences', 'School of Education',
       'School of Business', 'School of Technological Studies'
     )`,
  )
  if (catalog[0]?.schools === 4 && catalog[0]?.courses === 24) {
    console.log('ok   institutional catalog = 4 schools / 24 courses')
  } else {
    console.log(
      'FAIL institutional catalog must contain 4 schools / 24 courses',
    )
    failures.push('institutional catalog')
  }

  const { rows: safeguards } = await client.query(
    `select
      exists(select 1 from information_schema.columns
        where table_name = 'courses' and column_name = 'active'
          and is_nullable = 'NO') as course_active,
      exists(select 1 from information_schema.columns
        where table_name = 'submissions' and column_name = 'normalized_title'
          and is_nullable = 'NO') as normalized_title,
      exists(select 1 from pg_indexes
        where indexname = 'submissions_one_pending_title_per_submitter'
          and indexdef like '%UNIQUE%') as pending_title_guard`,
  )
  if (
    safeguards[0]?.course_active &&
    safeguards[0]?.normalized_title &&
    safeguards[0]?.pending_title_guard
  ) {
    console.log('ok   duplicate-title and course-availability safeguards')
  } else {
    console.log('FAIL duplicate-title or course-availability safeguard missing')
    failures.push('intake/catalog safeguards')
  }

  const { rows: roleState } = await client.query(
    `select rms.admin_count,
      (select count(*)::int from profiles where role = 'ADMIN') as actual
     from role_management_state rms where singleton = true`,
  )
  if (
    roleState.length === 1 &&
    Number(roleState[0].admin_count) === Number(roleState[0].actual)
  ) {
    console.log('ok   role-management admin counter is synchronized')
  } else {
    console.log('FAIL role-management admin counter is missing or out of sync')
    failures.push('role-management admin counter')
  }
} finally {
  await client.end()
}

if (failures.length > 0) {
  console.error(`\ndb:check failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('\ndb:check passed')
