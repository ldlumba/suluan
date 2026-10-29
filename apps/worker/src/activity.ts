import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app'
import { createDb } from './db'
import { effectiveVisibility, viewerRoleFor } from './visibility'

const activitySchema = z
  .object({
    recordId: z.string().uuid(),
    eventType: z.enum(['PAPER_VIEW', 'CITATION_COPY', 'DOWNLOAD_START']),
  })
  .strict()

/** Records only authorized, authenticated, coarse paper activity. */
export function activityRoutes(requireAuth: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>()
  app.post('/', requireAuth, zValidator('json', activitySchema), async (c) => {
    const body = c.req.valid('json')
    const profile = c.get('profile')
    const viewer = viewerRoleFor(profile.role)
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      insert into activity_events (profile_id, record_id, event_type)
      select ${profile.id}, r.id, ${body.eventType}::activity_event_type
      from research_records r
      join submissions s on s.id = r.submission_id
      where r.id = ${body.recordId}
        and s.status = 'ACCEPTED'
        and ${effectiveVisibility(viewer, 'r').rowVisible}
        and not exists (
          select 1 from activity_events prior
          where prior.profile_id = ${profile.id}
            and prior.record_id = r.id
            and prior.event_type = ${body.eventType}::activity_event_type
            and prior.created_at >= now() - interval '24 hours'
        )
      returning id
    `)
    c.header('Cache-Control', 'private, no-store')
    return c.json({ recorded: rows.rows.length > 0 })
  })
  return app
}
