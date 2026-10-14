import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { auditEvents, profiles } from '@suluan/db/schema'
import {
  deleteProfiles,
  insertProfile,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('admin role management', () => {
  let t: TestAuth
  let token: string
  let userToken: string
  let targetId = ''
  const adminUid = `role-admin-${crypto.randomUUID()}`
  const targetUid = `role-target-${crypto.randomUUID()}`

  async function synchronizeCounter() {
    await testDb().execute(sql`
      update role_management_state set admin_count =
        (select count(*)::int from profiles where role = 'ADMIN'),
        updated_at = now()
      where singleton = true
    `)
  }

  beforeAll(async () => {
    t = await setupTestAuth()
    await insertProfile(testDb(), adminUid, `${adminUid}@ua.edu.ph`, 'ADMIN')
    const target = await insertProfile(
      testDb(),
      targetUid,
      `${targetUid}@ua.edu.ph`,
      'USER',
    )
    targetId = target.id
    await synchronizeCounter()
    token = await t.mintToken({
      sub: adminUid,
      email: `${adminUid}@ua.edu.ph`,
      email_verified: true,
    })
    userToken = await t.mintToken({
      sub: targetUid,
      email: `${targetUid}@ua.edu.ph`,
      email_verified: true,
    })
  })

  afterAll(async () => {
    const rows = await testDb()
      .select({ id: profiles.id })
      .from(profiles)
      .where(sql`${profiles.firebaseUid} in (${adminUid}, ${targetUid})`)
    if (rows.length) {
      await testDb()
        .delete(auditEvents)
        .where(
          sql`${auditEvents.actorId} in (${sql.join(
            rows.map((row) => sql`${row.id}`),
            sql`, `,
          )}) or ${auditEvents.entityId} in (${sql.join(
            rows.map((row) => sql`${row.id}`),
            sql`, `,
          )})`,
        )
    }
    await deleteProfiles(testDb(), [adminUid, targetUid])
    await synchronizeCounter()
  })

  it('lists accounts only for administrators', async () => {
    expect((await t.authed('/api/admin/users', userToken)).status).toBe(403)
    const response = await t.authed('/api/admin/users', token)
    expect(response.status).toBe(200)
    const rows = (await response.json()) as { id: string }[]
    expect(rows.some((row) => row.id === targetId)).toBe(true)
  })

  it('changes a role atomically and records the actor and transition', async () => {
    const listed = await t.authed('/api/admin/users', token)
    const current = (
      (await listed.json()) as { id: string; updatedAt: string }[]
    ).find((row) => row.id === targetId)
    const response = await t.app.request(
      `/api/admin/users/${targetId}/role`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          role: 'REPOSITORY_MANAGER',
          expectedUpdatedAt: current?.updatedAt,
        }),
      },
      t.testEnv(),
    )
    const body = await response.json()
    expect({ status: response.status, body }).toMatchObject({
      status: 200,
      body: {
        id: targetId,
        role: 'REPOSITORY_MANAGER',
      },
    })
    const audit = await testDb().query.auditEvents.findFirst({
      where: sql`${auditEvents.action} = 'role.changed'
        and ${auditEvents.entityId} = ${targetId}`,
      orderBy: (event, { desc }) => [desc(event.createdAt)],
    })
    expect(audit?.context).toMatchObject({
      oldRole: 'USER',
      newRole: 'REPOSITORY_MANAGER',
    })
    expect(audit?.actorId).toBeTruthy()
  })

  it('rejects a stale role edit without another audit event', async () => {
    const response = await t.app.request(
      `/api/admin/users/${targetId}/role`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          role: 'USER',
          expectedUpdatedAt: new Date(0).toISOString(),
        }),
      },
      t.testEnv(),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'stale_role_edit' })
  })
})
