import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app-context'
import { createDb } from './db'
import { effectiveVisibilityLevel } from './visibility'

const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  schoolId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  sort: z
    .enum(['title', 'title_desc', 'newest', 'oldest', 'program'])
    .default('title'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
})
const changeSchema = z
  .object({
    visibility: z.enum(['PUBLIC', 'UA_ONLY', 'RESTRICTED']),
    embargoUntil: z.iso.date().nullable(),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => Number.isFinite(Date.parse(v))),
  })
  .strict()
  .refine(
    (v) =>
      v.embargoUntil === null ||
      (v.visibility !== 'PUBLIC' &&
        v.embargoUntil > new Date().toISOString().slice(0, 10)),
    {
      message:
        'Auto-lift date must be in the future and requires restricted access.',
    },
  )

export function recordAccessRoutes(
  auth: MiddlewareHandler<AppContext>,
  manager: MiddlewareHandler<AppContext>,
) {
  const app = new Hono<AppContext>()
  app.use('*', auth, manager, async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })
  app.get('/', zValidator('query', querySchema), async (c) => {
    const { q, schoolId, courseId, page, sort } = c.req.valid('query')
    const ordering = {
      title: sql`lower(r.title) asc, r.id asc`,
      title_desc: sql`lower(r.title) desc, r.id asc`,
      newest: sql`r.created_at desc, r.id asc`,
      oldest: sql`r.created_at asc, r.id asc`,
      program: sql`lower(course.name) asc nulls last, lower(r.title) asc, r.id asc`,
    }[sort]
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      select r.id, r.title, r.year, r.visibility, r.embargo_until::text as "embargoUntil",
        ${effectiveVisibilityLevel('r')} as "effectiveVisibility",
        r.updated_at::text as "updatedAt", school.name as "schoolName", course.name as "courseName"
      from research_records r join submissions s on s.id = r.submission_id
      left join schools school on school.id = s.school_id
      left join courses course on course.id = s.course_id
      where s.status = 'ACCEPTED' and (${q} = '' or r.title ilike ${pattern})
        and (${schoolId ?? null}::uuid is null or s.school_id = ${schoolId ?? null}::uuid)
        and (${courseId ?? null}::uuid is null or s.course_id = ${courseId ?? null}::uuid)
      order by ${ordering} limit 21 offset ${(page - 1) * 20}
    `)
    return c.json({
      items: rows.rows.slice(0, 20),
      hasMore: rows.rows.length > 20,
    })
  })
  app.patch(
    '/:id',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', changeSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const { visibility, embargoUntil, expectedUpdatedAt } =
        c.req.valid('json')
      const actor = c.get('profile').id
      const result = await createDb(c.env.DATABASE_URL).execute(sql`
      with target as materialized (
        select r.id, r.visibility, r.embargo_until from research_records r
        join submissions s on s.id = r.submission_id
        where r.id = ${id}::uuid and s.status = 'ACCEPTED'
          and r.updated_at = ${expectedUpdatedAt}::timestamptz
        for update of r
      ), changed as (
        update research_records r set visibility = ${visibility}::record_visibility,
          embargo_until = ${embargoUntil}::date, updated_at = clock_timestamp()
        from target t where r.id = t.id
          and (r.visibility is distinct from ${visibility}::record_visibility
            or r.embargo_until is distinct from ${embargoUntil}::date)
        returning r.id, t.visibility as old_visibility, t.embargo_until as old_embargo,
          r.visibility, r.embargo_until, r.updated_at
      ), audited as (
        insert into audit_events (actor_id, action, entity_type, entity_id, context)
        select ${actor}::uuid, 'record.access_changed', 'research_record', id::text,
          jsonb_build_object('oldVisibility', old_visibility, 'oldEmbargoUntil', old_embargo,
            'newVisibility', visibility, 'newEmbargoUntil', embargo_until)
        from changed returning id
      )
      select id from changed where exists (select 1 from audited)
    `)
      if (!result.rows.length)
        return c.json(
          {
            error: 'stale_or_unchanged',
            message:
              'This paper changed or the access is unchanged. Refresh and try again.',
          },
          409,
        )
      return c.json({ ok: true })
    },
  )
  return app
}
