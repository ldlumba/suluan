import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app'
import { createDb } from './db'
import {
  effectiveVisibility,
  effectiveVisibilityLevel,
  viewerRoleFor,
} from './visibility'

const recordParam = z.object({ id: z.string().uuid() })

export function bookmarkRoutes(requireAuth: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>()
  app.use('*', requireAuth)

  app.get('/', async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const profile = c.get('profile')
    const viewer = viewerRoleFor(profile.role)
    const rows = await db.execute(sql`
      select b.id as "bookmarkId", b.created_at as "createdAt",
        r.id, r.title, r.year::text as year,
        coalesce(authors.names, s.authors) as authors,
        school.name as "schoolName", course.name as "courseName",
        ${effectiveVisibilityLevel('r')} as visibility
      from bookmarks b
      join research_records r on r.id = b.record_id
      join submissions s on s.id = r.submission_id
      left join schools school on school.id = s.school_id
      left join courses course on course.id = s.course_id
      left join lateral (
        select string_agg(a.name, ', ' order by a.position, a.id) as names
        from record_authors a where a.record_id = r.id
      ) authors on true
      where b.profile_id = ${profile.id}
        and s.status = 'ACCEPTED'
        and ${effectiveVisibility(viewer, 'r').rowVisible}
      order by b.created_at desc, b.id
      limit 200
    `)
    return c.json(rows.rows)
  })

  app.get('/:id', zValidator('param', recordParam), async (c) => {
    const recordId = c.req.valid('param').id
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      select exists(
        select 1 from bookmarks
        where profile_id = ${c.get('profile').id} and record_id = ${recordId}
      ) as bookmarked
    `)
    return c.json({ bookmarked: Boolean(rows.rows[0]?.bookmarked) })
  })

  app.post('/:id', zValidator('param', recordParam), async (c) => {
    const recordId = c.req.valid('param').id
    const profile = c.get('profile')
    const viewer = viewerRoleFor(profile.role)
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      insert into bookmarks (profile_id, record_id)
      select ${profile.id}, r.id
      from research_records r
      join submissions s on s.id = r.submission_id
      where r.id = ${recordId}
        and s.status = 'ACCEPTED'
        and ${effectiveVisibility(viewer, 'r').rowVisible}
      on conflict (profile_id, record_id) do update
        set created_at = bookmarks.created_at
      returning id
    `)
    if (!rows.rows.length) return c.json({ error: 'record_not_found' }, 404)
    return c.json({ bookmarked: true })
  })

  app.delete('/:id', zValidator('param', recordParam), async (c) => {
    const recordId = c.req.valid('param').id
    await createDb(c.env.DATABASE_URL).execute(sql`
      delete from bookmarks
      where profile_id = ${c.get('profile').id} and record_id = ${recordId}
    `)
    return c.json({ bookmarked: false })
  })

  return app
}
