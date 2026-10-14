import { loadRootEnv, requireDatabaseUrl } from './env.mjs'

/**
 * DEV ONLY. Promotes an existing profile to ADMIN by verified email.
 * Operates on the dev database only; production first-admin provisioning
 * is TBD (Architecture v1 §10) and must NOT use this script.
 *
 * Usage: npm run promote-admin -w @suluan/db -- <email>
 */
loadRootEnv()
const connectionString = requireDatabaseUrl()

const email = process.argv[2]
if (!email || !email.includes('@')) {
  console.error('Usage: npm run promote-admin -w @suluan/db -- <email>')
  process.exit(1)
}

const { Client } = await import('pg')
const client = new Client({ connectionString })
await client.connect()
try {
  const { rows } = await client.query(
    `with target as materialized (
       select id, role from profiles where lower(email) = lower($1) for update
     ), changed as (
       update profiles p set role = 'ADMIN', updated_at = now()
       from target where p.id = target.id and p.role <> 'ADMIN'
       returning p.id, p.firebase_uid, p.email, p.role, target.role as old_role
     ), state as (
       update role_management_state set admin_count = admin_count + 1,
         updated_at = now() where singleton = true
         and exists (select 1 from changed)
     ), audit as (
       insert into audit_events
         (actor_id, action, entity_type, entity_id, context)
       select null, 'role.dev_promote_admin', 'profile', id::text,
         jsonb_build_object('oldRole', old_role, 'newRole', role)
       from changed
     )
     select id, firebase_uid as "firebaseUid", email, role from changed
     union all
     select p.id, p.firebase_uid, p.email, p.role from profiles p
       join target on target.id = p.id where target.role = 'ADMIN'`,
    [email],
  )
  if (rows.length === 0) {
    console.error(
      `No profile with email ${email}. Sign in once first so the profile exists, then retry.`,
    )
    process.exit(1)
  }
  console.log(`Promoted to ADMIN: ${rows[0].email} (${rows[0].firebaseUid})`)
} finally {
  await client.end()
}
