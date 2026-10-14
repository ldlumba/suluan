import { loadRootEnv, requireDatabaseUrl } from './env.mjs'

/**
 * One-time, production-only first-admin bootstrap. The profile must already
 * exist after one verified Firebase sign-in. The role write, ADMIN counter,
 * and audit event commit together.
 */
loadRootEnv()

function argument(name) {
  const position = process.argv.indexOf(name)
  return position >= 0 ? process.argv[position + 1] : undefined
}

const email = argument('--email')?.trim().toLowerCase()
const expectedHost = argument('--expected-host')?.trim().toLowerCase()
const confirmation = argument('--confirm')
const environment = process.env.SULUAN_ENVIRONMENT?.trim().toLowerCase()
const expectedConfirmation = email ? `BOOTSTRAP ${email} IN PRODUCTION` : ''

if (
  !email?.endsWith('@ua.edu.ph') ||
  !expectedHost ||
  confirmation !== expectedConfirmation ||
  environment !== 'production'
) {
  console.error(
    'Set SULUAN_ENVIRONMENT=production, then run:\n' +
      'npm run db:bootstrap-admin:production -- ' +
      '--email <verified@ua.edu.ph> --expected-host <neon-direct-host> ' +
      '--confirm "BOOTSTRAP <verified@ua.edu.ph> IN PRODUCTION"',
  )
  process.exit(1)
}

const connectionString = requireDatabaseUrl()
const target = new URL(connectionString)
if (
  target.hostname.toLowerCase() !== expectedHost ||
  target.hostname.includes('-pooler.')
) {
  console.error(
    'DATABASE_URL must use the explicitly confirmed production Neon direct host.',
  )
  process.exit(1)
}

const { Client } = await import('pg')
const client = new Client({ connectionString })
await client.connect()
try {
  await client.query('begin')
  const { rows } = await client.query(
    `with target as materialized (
       select id, role from profiles where lower(email) = lower($1) for update
     ), state as (
       update role_management_state set admin_count = 1, updated_at = now()
       where singleton = true and admin_count = 0
         and exists (select 1 from target where role <> 'ADMIN')
       returning admin_count
     ), changed as (
       update profiles p set role = 'ADMIN', updated_at = now()
       from target, state where p.id = target.id and p.role = target.role
       returning p.id, p.email, target.role as old_role, p.updated_at
     ), audited as (
       insert into audit_events
         (actor_id, action, entity_type, entity_id, context)
       select null, 'role.bootstrap_admin', 'profile', id::text,
         jsonb_build_object(
           'environment', 'production',
           'method', 'bootstrap-production-admin',
           'oldRole', old_role,
           'newRole', 'ADMIN'
         )
       from changed
     )
     select id, email, old_role as "oldRole", updated_at as "updatedAt"
     from changed`,
    [email],
  )
  if (rows.length !== 1) {
    throw new Error(
      'Bootstrap refused: profile missing, already ADMIN, or an ADMIN already exists.',
    )
  }
  await client.query('commit')
  console.log(
    `Bootstrapped ${rows[0].email} as the first production ADMIN on ${target.hostname}; audit event recorded.`,
  )
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
