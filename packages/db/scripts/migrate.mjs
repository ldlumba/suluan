import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'
import { loadRootEnv, requireDatabaseUrl } from './env.mjs'

loadRootEnv()
const connectionString = requireDatabaseUrl()

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = new Client({ connectionString })
await client.connect()
try {
  await migrate(drizzle(client), {
    migrationsFolder: path.join(pkgDir, 'drizzle'),
  })
  console.log('migrations applied')
} finally {
  await client.end()
}
