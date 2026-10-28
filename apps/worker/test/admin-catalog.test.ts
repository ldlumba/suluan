import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { auditEvents, courses, schools } from '@suluan/db/schema'
import {
  deleteProfiles,
  insertProfile,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('admin course availability', () => {
  let t: TestAuth
  let token: string
  const uid = `catalog-admin-${crypto.randomUUID()}`
  let courseId = ''

  beforeAll(async () => {
    t = await setupTestAuth()
    await insertProfile(testDb(), uid, `${uid}@ua.edu.ph`, 'ADMIN')
    token = await t.mintToken({ sub: uid, email: `${uid}@ua.edu.ph` })
    const [school] = await testDb()
      .select({ id: schools.id })
      .from(schools)
      .limit(1)
    const [course] = await testDb()
      .insert(courses)
      .values({
        schoolId: school.id,
        name: `Catalog availability test ${crypto.randomUUID()}`,
      })
      .returning()
    courseId = course.id
  })

  afterAll(async () => {
    const actor = await testDb().query.profiles.findFirst({
      where: (profile, { eq }) => eq(profile.firebaseUid, uid),
    })
    if (actor)
      await testDb()
        .delete(auditEvents)
        .where(eq(auditEvents.actorId, actor.id))
    if (courseId) await testDb().delete(courses).where(eq(courses.id, courseId))
    await deleteProfiles(testDb(), [uid])
  })

  it('soft-hides a course, rejects stale edits, and preserves its row', async () => {
    const headers = { authorization: `Bearer ${token}` }
    const catalog = await t.app.request(
      '/api/admin/catalog',
      { headers },
      t.testEnv(),
    )
    expect(catalog.status).toBe(200)
    const row = (
      (await catalog.json()) as {
        id: string
        schoolId: string
        updatedAt: string
      }[]
    ).find((item) => item.id === courseId)!
    const hide = () =>
      t.app.request(
        `/api/admin/courses/${courseId}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            active: false,
            expectedUpdatedAt: row.updatedAt,
          }),
        },
        t.testEnv(),
      )
    expect((await hide()).status).toBe(200)
    const stale = await hide()
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: 'stale_course_edit' })

    const publicCatalog = await t.app.request(
      '/api/schools',
      { headers },
      t.testEnv(),
    )
    const schools = (await publicCatalog.json()) as {
      courses: { id: string }[]
    }[]
    expect(schools.flatMap((school) => school.courses)).not.toContainEqual(
      expect.objectContaining({ id: courseId }),
    )

    const form = new FormData()
    form.append(
      'file',
      new File(['paper'], 'paper.pdf', { type: 'application/pdf' }),
    )
    form.append('title', `Inactive course ${crypto.randomUUID()}`)
    form.append('idempotencyKey', crypto.randomUUID())
    form.append('schoolId', row.schoolId)
    form.append('courseId', row.id)
    const objectsBefore = t.r2objects.size
    const crafted = await t.app.request(
      '/api/submissions',
      { method: 'POST', headers, body: form },
      t.testEnv(),
    )
    expect(crafted.status).toBe(409)
    expect(await crafted.json()).toMatchObject({ error: 'course_inactive' })
    expect(t.r2objects.size).toBe(objectsBefore)
    expect(
      await testDb().select().from(courses).where(eq(courses.id, courseId)),
    ).toHaveLength(1)
  })
})
