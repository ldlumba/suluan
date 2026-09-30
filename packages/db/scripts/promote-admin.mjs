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
    `update profiles set role = 'ADMIN', updated_at = now()
     where lower(email) = lower($1)
     returning id, firebase_uid as "firebaseUid", email, role`,
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
