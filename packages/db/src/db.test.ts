import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { loadRootEnv } from '../scripts/env.mjs'

loadRootEnv()
// No DATABASE_URL (fresh clone, CI without secrets) → skip, don't fail.
// `npm run check` must stay green before Stage 1 credentials exist.
const connectionString = process.env.DATABASE_URL

describe.skipIf(!connectionString)('stage 1 database', () => {
  it('connects and sees the identity domain', async () => {
    const client = new Client({ connectionString })
    await client.connect()
    try {
      const { rows } = await client.query(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_name in ('profiles', 'schools', 'courses')`,
      )
      expect(rows.map((r) => r.table_name).sort()).toEqual([
        'courses',
        'profiles',
        'schools',
      ])
    } finally {
      await client.end()
    }
  })
})
