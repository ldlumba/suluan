import { eq, sql } from 'drizzle-orm'
import { zValidator } from '@hono/zod-validator'
import { courses, profiles } from '@suluan/db/schema'
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { AppContext } from './app-context'
import { createDb } from './db'

const timestampSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: 'Use a valid timestamp.',
  })

/**
 * Register the narrow ADMIN-only account and catalog boundaries. Keeping these
 * routes together makes their shared authorization and audit policy explicit.
 */
export function registerAdminRoutes(
  app: Hono<AppContext>,
  requireAuth: MiddlewareHandler<AppContext>,
  requireAdmin: MiddlewareHandler<AppContext>,
) {
  app.get('/api/admin/status', requireAuth, requireAdmin, (c) =>
    c.json({ status: 'ok', scope: 'admin' }),
  )

  app.get('/api/admin/activity', requireAuth, requireAdmin, async (c) => {
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      select
        count(*) filter (where event_type = 'PAPER_VIEW')::integer as "paperViews",
        count(*) filter (where event_type = 'CITATION_COPY')::integer as "citationCopies",
        count(*) filter (where event_type = 'DOWNLOAD_START')::integer as "downloadStarts",
        count(distinct profile_id) filter (where event_type = 'PAPER_VIEW')::integer as "viewers",
        count(distinct record_id) filter (where event_type = 'PAPER_VIEW')::integer as "viewedPapers"
      from activity_events
      where created_at >= now() - interval '90 days'
    `)
    return c.json(rows.rows[0] ?? {})
  })

  app.get('/api/admin/users', requireAuth, requireAdmin, async (c) => {
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      select id, email, display_name as "displayName", role,
        created_at as "createdAt", updated_at as "updatedAt"
      from profiles
      order by case role when 'ADMIN' then 0
        when 'REPOSITORY_MANAGER' then 1 else 2 end,
        lower(coalesce(email, '')), id
      limit 500
    `)
    return c.json(rows.rows)
  })

  app.patch(
    '/api/admin/users/:id/role',
    requireAuth,
    requireAdmin,
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator(
      'json',
      z
        .object({
          role: z.enum(['USER', 'REPOSITORY_MANAGER', 'ADMIN']),
          expectedUpdatedAt: timestampSchema,
        })
        .strict(),
    ),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const id = c.req.valid('param').id
      const body = c.req.valid('json')
      const rows = await db.execute(sql`
        with target as materialized (
          select id, role as old_role from profiles
          where id = ${id}
            and updated_at = ${body.expectedUpdatedAt}::timestamptz
          for update
        ), guard as (
          update role_management_state rms
          set admin_count = rms.admin_count + case
                when target.old_role = 'ADMIN' and ${body.role} <> 'ADMIN' then -1
                when target.old_role <> 'ADMIN' and ${body.role} = 'ADMIN' then 1
                else 0 end,
              updated_at = now()
          from target
          where rms.singleton = true
            and target.old_role <> ${body.role}
            and rms.admin_count + case
                when target.old_role = 'ADMIN' and ${body.role} <> 'ADMIN' then -1
                when target.old_role <> 'ADMIN' and ${body.role} = 'ADMIN' then 1
                else 0 end >= 1
          returning rms.admin_count
        ), changed as (
          update profiles p set role = ${body.role}::role, updated_at = now()
          from target, guard
          where p.id = target.id and p.role = target.old_role
          returning p.id, p.email, p.display_name as "displayName", p.role,
            p.created_at as "createdAt", p.updated_at as "updatedAt",
            target.old_role
        ), audited as (
          insert into audit_events
            (actor_id, action, entity_type, entity_id, context)
          select ${c.get('profile').id}, 'role.changed', 'profile', id::text,
            jsonb_build_object('oldRole', old_role, 'newRole', role)
          from changed
        )
        select id, email, "displayName", role, "createdAt", "updatedAt"
        from changed
      `)
      if (rows.rows.length) return c.json(rows.rows[0])

      const current = await db.query.profiles.findFirst({
        where: eq(profiles.id, id),
      })
      if (!current) return c.json({ error: 'profile_not_found' }, 404)
      if (current.updatedAt.toISOString() !== body.expectedUpdatedAt) {
        return c.json(
          {
            error: 'stale_role_edit',
            message:
              'This account changed after the page loaded. Refresh before trying again.',
          },
          409,
        )
      }
      if (current.role === body.role) {
        return c.json(
          { error: 'role_unchanged', message: 'Choose a different role.' },
          400,
        )
      }
      if (current.role === 'ADMIN' && body.role !== 'ADMIN') {
        return c.json(
          {
            error: 'last_admin_required',
            message:
              'Add another administrator before changing the final administrator account.',
          },
          409,
        )
      }
      return c.json(
        {
          error: 'role_state_conflict',
          message:
            'The role-management state is unavailable or out of sync. Run db:check before retrying.',
        },
        409,
      )
    },
  )

  app.get('/api/admin/catalog', requireAuth, requireAdmin, async (c) => {
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      select s.id as "schoolId", s.name as "schoolName", c.id, c.name,
        c.active, c.updated_at as "updatedAt"
      from schools s join courses c on c.school_id = s.id
      order by s.name, c.name
    `)
    return c.json(rows.rows)
  })

  app.patch(
    '/api/admin/courses/:id',
    requireAuth,
    requireAdmin,
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator(
      'json',
      z
        .object({ active: z.boolean(), expectedUpdatedAt: timestampSchema })
        .strict(),
    ),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const body = c.req.valid('json')
      const id = c.req.valid('param').id
      const rows = await db.execute(sql`
        with changed as (
          update courses set active = ${body.active}, updated_at = now()
          where id = ${id}
            and updated_at = ${body.expectedUpdatedAt}::timestamptz
          returning id, active, updated_at
        ), audit as (
          insert into audit_events
            (actor_id, action, entity_type, entity_id, context)
          select ${c.get('profile').id},
            case when active then 'course.activated' else 'course.deactivated' end,
            'course', id::text,
            jsonb_build_object('active', active)
          from changed
        )
        select id, active, updated_at as "updatedAt" from changed
      `)
      if (rows.rows.length) return c.json(rows.rows[0])
      const found = await db.query.courses.findFirst({
        where: eq(courses.id, id),
      })
      return found
        ? c.json(
            {
              error: 'stale_course_edit',
              message:
                'This course changed after the page loaded. Refresh before trying again.',
            },
            409,
          )
        : c.json({ error: 'course_not_found' }, 404)
    },
  )
}
