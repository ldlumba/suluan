import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app'
import { createDb } from './db'

const idSchema = z.object({ id: z.string().uuid() })
const claimSchema = z.object({ jobId: z.string().uuid().optional() }).strict()
const claimQuerySchema = z.object({ claimToken: z.string().uuid() })
const resultSchema = z.discriminatedUnion('status', [
  z
    .object({
      claimToken: z.string().uuid(),
      status: z.literal('EXTRACTED'),
      result: z
        .object({
          text: z.string().trim().min(1).max(500_000),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          parser: z.string().min(1).max(100),
          pageCount: z.number().int().min(1).max(1000).nullable(),
          warnings: z.array(z.enum(['PAGES_WITHOUT_TEXT'])).max(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      claimToken: z.string().uuid(),
      status: z.literal('FAILED'),
      errorCode: z.enum([
        'NO_EXTRACTABLE_TEXT',
        'INVALID_DOCUMENT',
        'ENCRYPTED_DOCUMENT',
        'PROCESSING_LIMIT',
        'DOWNLOAD_FAILED',
        'PROCESSOR_FAILED',
      ]),
    })
    .strict(),
])

/** Manager operations remain separate from the Cloud Run workload boundary.
 * These routes require existing Firebase + Neon manager authorization.
 */
export function processingRoutes(authorize: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>()
  app.use('*', authorize)
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })
  app.get('/jobs', async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const rows = await db.execute(sql`
      select j.id, j.status, j.attempts, j.error_code as "errorCode",
        r.title, r.submission_id as "submissionId"
      from processing_jobs j join research_records r on r.id = j.record_id
      join submissions s on s.id = r.submission_id
      where s.status = 'ACCEPTED' order by j.created_at limit 100
    `)
    return c.json(rows.rows)
  })
  app.post('/:id/claim', zValidator('param', idSchema), async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const token = crypto.randomUUID()
    const rows = await db.execute(sql`
      with claimed as (
        update processing_jobs j set status = 'PROCESSING', attempts = attempts + 1,
          claim_token = ${token}, lease_until = now() + interval '10 minutes',
          error_code = null, updated_at = now()
        from research_records r, submissions s
        where j.id = ${c.req.valid('param').id} and j.record_id = r.id
          and s.id = r.submission_id and s.status = 'ACCEPTED'
          and (j.status = 'QUEUED' or
            (j.status = 'PROCESSING' and j.lease_until < now()))
        returning j.id, r.submission_id
      ), audit as (
        insert into audit_events (actor_id, action, entity_type, entity_id)
        select ${c.get('profile').id}, 'extraction.claimed', 'processing_job', id::text from claimed
      ) select id, submission_id as "submissionId" from claimed
    `)
    if (!rows.rows.length) return c.json({ error: 'job_not_claimable' }, 409)
    return c.json({ ...rows.rows[0], claimToken: token })
  })
  app.post(
    '/:id/result',
    zValidator('param', idSchema),
    bodyLimit({ maxSize: 4 * 1024 * 1024 }),
    zValidator('json', resultSchema),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const body = c.req.valid('json')
      const result =
        body.status === 'EXTRACTED' ? JSON.stringify(body.result) : null
      const errorCode = body.status === 'FAILED' ? body.errorCode : null
      const rows = await db.execute(sql`
        with finished as (
          update processing_jobs j set status = ${body.status}, result = ${result}::jsonb,
            error_code = ${errorCode}, lease_until = null, updated_at = now()
          from research_records r, submissions s
          where j.id = ${c.req.valid('param').id} and j.claim_token = ${body.claimToken}
            and j.status = 'PROCESSING' and j.lease_until > now()
            and j.record_id = r.id and s.id = r.submission_id and s.status = 'ACCEPTED'
          returning j.id
        ), audit as (
          insert into audit_events (actor_id, action, entity_type, entity_id)
          select ${c.get('profile').id}, ${body.status === 'EXTRACTED' ? 'extraction.completed' : 'extraction.failed'},
            'processing_job', id::text from finished
        ) select id from finished
      `)
      if (rows.rows.length) return c.json({ status: body.status })
      // Repeated delivery of the identical result is harmless. A stale token
      // cannot overwrite a newer attempt, even after that attempt finishes.
      const replay = await db.execute(sql`
        select id from processing_jobs where id = ${c.req.valid('param').id}
          and claim_token = ${body.claimToken} and status = ${body.status}
          and result is not distinct from ${result}::jsonb
          and error_code is not distinct from ${errorCode}::text
      `)
      return replay.rows.length
        ? c.json({ status: body.status })
        : c.json({ error: 'stale_claim' }, 409)
    },
  )
  app.post('/:id/retry', zValidator('param', idSchema), async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const rows = await db.execute(sql`
      with retried as (
        update processing_jobs j set status = 'QUEUED', claim_token = null,
          lease_until = null, error_code = null, updated_at = now()
        from research_records r, submissions s
        where j.id = ${c.req.valid('param').id} and j.status = 'FAILED'
          and j.record_id = r.id and s.id = r.submission_id and s.status = 'ACCEPTED'
        returning j.id
      ), audit as (
        insert into audit_events (actor_id, action, entity_type, entity_id)
        select ${c.get('profile').id}, 'extraction.retried', 'processing_job', id::text from retried
      ) select id from retried
    `)
    return rows.rows.length
      ? c.json({ status: 'QUEUED' })
      : c.json({ error: 'job_not_retryable' }, 409)
  })
  return app
}

/**
 * Cloud Run Job pull API. A Google workload token reaches only these claim-
 * scoped extraction operations; it never receives manager or user privileges.
 */
export function serviceProcessingRoutes(
  authorize: MiddlewareHandler<AppContext>,
) {
  const app = new Hono<AppContext>()
  app.use('*', authorize)
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  app.post('/claim', zValidator('json', claimSchema), async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const jobId = c.req.valid('json').jobId ?? null
    const token = crypto.randomUUID()
    const service = c.get('serviceIdentity').email
    const rows = await db.execute(sql`
      with candidate as (
        select j.id from processing_jobs j
        join research_records r on r.id = j.record_id
        join submissions s on s.id = r.submission_id
        where s.status = 'ACCEPTED'
          and (${jobId}::uuid is null or j.id = ${jobId}::uuid)
          and (j.status = 'QUEUED' or
            (j.status = 'PROCESSING' and j.lease_until < now()))
        order by j.created_at, j.id
        for update of j skip locked limit 1
      ), claimed as (
        update processing_jobs j set status = 'PROCESSING', attempts = attempts + 1,
          claim_token = ${token}, lease_until = now() + interval '10 minutes',
          error_code = null, updated_at = now()
        from candidate c, research_records r
        where j.id = c.id and j.record_id = r.id
        returning j.id, r.submission_id
      ), audit as (
        insert into audit_events
          (actor_id, action, entity_type, entity_id, context)
        select null, 'extraction.claimed', 'processing_job', id::text,
          jsonb_build_object('serviceAccount', ${service}::text) from claimed
      ) select id as "jobId", submission_id as "submissionId" from claimed
    `)
    if (!rows.rows.length) return c.body(null, 204)
    return c.json({ ...rows.rows[0], claimToken: token })
  })

  app.get(
    '/:id/download',
    zValidator('param', idSchema),
    zValidator('query', claimQuerySchema),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const found = await db.execute(sql`
        select f.r2_key as "r2Key", f.mime_type as "mimeType"
        from processing_jobs j
        join research_records r on r.id = j.record_id
        join submissions s on s.id = r.submission_id
        join record_files f on f.record_id = r.id
        where j.id = ${c.req.valid('param').id}
          and j.claim_token = ${c.req.valid('query').claimToken}
          and j.status = 'PROCESSING' and j.lease_until > now()
          and s.status = 'ACCEPTED'
        limit 1
      `)
      if (!found.rows.length) return c.json({ error: 'stale_claim' }, 409)
      const file = found.rows[0] as { r2Key: string; mimeType: string | null }
      const object = await c.env.DOCUMENTS.get(file.r2Key)
      if (!object) return c.json({ error: 'file_missing' }, 410)
      return new Response(object.body, {
        headers: {
          'content-type':
            file.mimeType ?? object.contentType ?? 'application/octet-stream',
          'content-length': String(object.size),
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    },
  )

  app.post(
    '/:id/result',
    zValidator('param', idSchema),
    bodyLimit({ maxSize: 4 * 1024 * 1024 }),
    zValidator('json', resultSchema),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const body = c.req.valid('json')
      const result =
        body.status === 'EXTRACTED' ? JSON.stringify(body.result) : null
      const errorCode = body.status === 'FAILED' ? body.errorCode : null
      const service = c.get('serviceIdentity').email
      const rows = await db.execute(sql`
        with finished as (
          update processing_jobs j set status = ${body.status},
            result = ${result}::jsonb, error_code = ${errorCode},
            lease_until = null, updated_at = now()
          from research_records r, submissions s
          where j.id = ${c.req.valid('param').id}
            and j.claim_token = ${body.claimToken}
            and j.status = 'PROCESSING' and j.lease_until > now()
            and j.record_id = r.id and s.id = r.submission_id
            and s.status = 'ACCEPTED'
          returning j.id
        ), audit as (
          insert into audit_events
            (actor_id, action, entity_type, entity_id, context)
          select null,
            ${body.status === 'EXTRACTED' ? 'extraction.completed' : 'extraction.failed'},
            'processing_job', id::text,
            jsonb_build_object('serviceAccount', ${service}::text) from finished
        ) select id from finished
      `)
      if (rows.rows.length) return c.json({ status: body.status })
      const replay = await db.execute(sql`
        select id from processing_jobs where id = ${c.req.valid('param').id}
          and claim_token = ${body.claimToken} and status = ${body.status}
          and result is not distinct from ${result}::jsonb
          and error_code is not distinct from ${errorCode}::text
      `)
      return replay.rows.length
        ? c.json({ status: body.status })
        : c.json({ error: 'stale_claim' }, 409)
    },
  )

  return app
}
