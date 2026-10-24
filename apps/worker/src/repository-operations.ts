import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { bodyLimit } from 'hono/body-limit'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app'
import { CHUNKER_VERSION } from './chunking'
import { createDb } from './db'
import { embeddingLimits } from './quota'
import { indexExtractedRecords, KEYWORD_SWEEP_BATCH } from './search'

const actionSchema = z.enum(['EXTRACTION', 'EMBEDDING'])
const redeemSchema = z.object({ ticket: z.string().uuid() }).strict()
const resultSchema = z
  .object({
    operationId: z.string().uuid(),
    status: z.enum(['LAUNCHED', 'FAILED']),
    executionName: z.string().max(500).optional(),
    errorCode: z.string().max(80).optional(),
  })
  .strict()

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function safeErrorCode(value: unknown): string {
  if (value instanceof Error && value.name === 'AbortError') return 'timeout'
  return 'dispatcher_unavailable'
}

export function repositoryOperationRoutes(
  requireAuth: MiddlewareHandler<AppContext>,
  requireManager: MiddlewareHandler<AppContext>,
) {
  const app = new Hono<AppContext>()
  app.use('*', requireAuth, requireManager)
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  app.get('/status', async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const [pipeline, usage, recent] = await Promise.all([
      db.execute(sql`
        select
          count(*) filter (where p.status = 'QUEUED' or
            (p.status = 'PROCESSING' and p.lease_until < now()))::integer as "queuedExtraction",
          count(*) filter (where p.status = 'PROCESSING' and p.lease_until >= now())::integer as "processingExtraction",
          count(*) filter (where p.status = 'FAILED')::integer as "failedExtraction",
          count(*) filter (
            where p.status = 'EXTRACTED' and not exists (
              select 1 from keyword_indexes k
              where k.record_id = p.record_id
                and k.extraction_claim_token = p.claim_token
                and k.chunker_version = ${CHUNKER_VERSION}
            )
          )::integer as "unindexedRecords",
          count(distinct k.record_id) filter (where e.id is null)::integer as "missingEmbeddingRecords",
          count(d.id) filter (where e.id is null)::integer as "missingEmbeddingChunks"
        from processing_jobs p
        left join keyword_indexes k on k.record_id = p.record_id
          and k.extraction_claim_token = p.claim_token
          and k.chunker_version = ${CHUNKER_VERSION}
        left join document_chunks d on d.index_id = k.id
        left join document_embeddings e on e.chunk_id = d.id
      `),
      db.execute(sql`
        select requests, inputs from embedding_usage
        where bucket = 'dev_global' and actor_key = 'all'
          and day = current_date
        limit 1
      `),
      db.execute(sql`
        select id, action, status, execution_name as "executionName",
          error_code as "errorCode", created_at as "createdAt",
          updated_at as "updatedAt"
        from repository_operation_runs
        order by created_at desc limit 8
      `),
    ])
    const counts = (pipeline.rows[0] ?? {}) as Record<string, unknown>
    const used = (usage.rows[0] as
      { requests: number; inputs: number } | undefined) ?? {
      requests: 0,
      inputs: 0,
    }
    const limits = embeddingLimits(
      c.env.EMBEDDING_DAILY_REQUEST_LIMIT,
      c.env.EMBEDDING_DAILY_INPUT_LIMIT,
    )
    return c.json({
      pipeline: {
        queuedExtraction: Number(counts.queuedExtraction ?? 0),
        processingExtraction: Number(counts.processingExtraction ?? 0),
        failedExtraction: Number(counts.failedExtraction ?? 0),
        unindexedRecords: Number(counts.unindexedRecords ?? 0),
        missingEmbeddingRecords: Number(counts.missingEmbeddingRecords ?? 0),
        missingEmbeddingChunks: Number(counts.missingEmbeddingChunks ?? 0),
      },
      embeddingQuota: {
        requestsUsed: Number(used.requests),
        requestsLimit: limits.maxRequests,
        inputsUsed: Number(used.inputs),
        inputsLimit: limits.maxInputs,
      },
      dispatcherConfigured: Boolean(c.env.OPERATIONS_DISPATCHER_URL?.trim()),
      recentRuns: recent.rows,
    })
  })

  app.post('/index', async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const actorId = c.get('profile').id
    const result = await indexExtractedRecords(db, {
      actorId,
      context: { trigger: 'manager_manual' },
      limit: KEYWORD_SWEEP_BATCH,
    })
    await db.execute(sql`
      insert into audit_events (actor_id, action, entity_type, entity_id, context)
      values (${actorId}, 'repository_operation.index_requested', 'repository_pipeline',
        'keyword', ${JSON.stringify(result)}::jsonb)
    `)
    return c.json(result)
  })

  app.post(
    '/:action',
    zValidator(
      'param',
      z.object({ action: z.enum(['extraction', 'embedding']) }),
    ),
    async (c) => {
      const dispatcherUrl = c.env.OPERATIONS_DISPATCHER_URL?.trim()
      if (!dispatcherUrl)
        return c.json(
          {
            error: 'dispatcher_not_configured',
            message: 'Manual job launch is not configured.',
          },
          503,
        )
      const action = actionSchema.parse(
        c.req.valid('param').action.toUpperCase(),
      )
      const db = createDb(c.env.DATABASE_URL)
      const actorId = c.get('profile').id

      const eligible = await db.execute(
        action === 'EXTRACTION'
          ? sql`
            select exists (
              select 1 from processing_jobs p
              join research_records r on r.id = p.record_id
              join submissions s on s.id = r.submission_id
              where s.status = 'ACCEPTED' and (
                p.status = 'QUEUED' or
                (p.status = 'PROCESSING' and p.lease_until < now())
              )
            ) as ready
          `
          : sql`
            select exists (
              select 1 from keyword_indexes k
              join document_chunks d on d.index_id = k.id
              join research_records r on r.id = k.record_id
              join submissions s on s.id = r.submission_id
              where s.status = 'ACCEPTED' and k.chunker_version = ${CHUNKER_VERSION}
                and not exists (select 1 from document_embeddings e where e.chunk_id = d.id)
            ) and not exists (
              select 1 from embedding_claims
              where kind = 'prep' and used_at is null and expires_at > now()
            ) as ready
          `,
      )
      if (!(eligible.rows[0] as { ready: boolean }).ready)
        return c.json(
          {
            error: 'no_work',
            message: 'There is no eligible work for this operation.',
          },
          409,
        )

      await db.execute(sql`
      update repository_operation_runs
      set status = 'FAILED', error_code = 'ticket_expired', updated_at = now()
      where status in ('REQUESTED', 'DISPATCHING') and expires_at <= now()
    `)
      const recent = await db.execute(sql`
      select id from repository_operation_runs
      where action = ${action} and created_at > now() - interval '60 seconds'
        and status in ('REQUESTED', 'DISPATCHING', 'LAUNCHED')
      limit 1
    `)
      if (recent.rows.length)
        return c.json(
          {
            error: 'operation_cooldown',
            message:
              'This operation was started recently. Refresh status before trying again.',
          },
          409,
        )

      const ticket = crypto.randomUUID()
      const ticketHash = await sha256(ticket)
      let operationId: string
      try {
        const inserted = await db.execute(sql`
        with run as (
          insert into repository_operation_runs
            (actor_id, action, ticket_hash, expires_at)
          values (${actorId}, ${action}, ${ticketHash}, now() + interval '2 minutes')
          returning id
        ), audit as (
          insert into audit_events (actor_id, action, entity_type, entity_id, context)
          select ${actorId}, 'repository_operation.requested', 'repository_operation',
            run.id::text, jsonb_build_object('operation', ${action}) from run
        ) select id from run
      `)
        operationId = (inserted.rows[0] as { id: string }).id
      } catch (error) {
        const active = await db.execute(sql`
        select id from repository_operation_runs
        where action = ${action} and status in ('REQUESTED', 'DISPATCHING')
        limit 1
      `)
        if (active.rows.length)
          return c.json(
            {
              error: 'operation_busy',
              message: 'This operation is already being dispatched.',
            },
            409,
          )
        throw error
      }

      try {
        const response = await fetch(dispatcherUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket }),
          signal: AbortSignal.timeout(20_000),
        })
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        if (!response.ok)
          throw new Error(String(body.error ?? `HTTP ${response.status}`))
        return c.json(
          {
            operationId,
            action,
            status: 'LAUNCHED',
            executionName:
              typeof body.executionName === 'string'
                ? body.executionName
                : null,
          },
          202,
        )
      } catch (error) {
        const errorCode = safeErrorCode(error)
        await db.execute(sql`
        update repository_operation_runs
        set status = 'FAILED', error_code = ${errorCode}, updated_at = now()
        where id = ${operationId} and status in ('REQUESTED', 'DISPATCHING')
      `)
        return c.json(
          {
            error: errorCode,
            message:
              'The job could not be started. No automatic retry was made.',
          },
          502,
        )
      }
    },
  )

  return app
}

export function serviceRepositoryOperationRoutes(
  authorize: MiddlewareHandler<AppContext>,
) {
  const app = new Hono<AppContext>()
  app.use('*', authorize)
  app.use('*', bodyLimit({ maxSize: 1024 }))
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  app.post('/redeem', zValidator('json', redeemSchema), async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const ticketHash = await sha256(c.req.valid('json').ticket)
    const redeemed = await db.execute(sql`
      update repository_operation_runs
      set status = 'DISPATCHING', updated_at = now()
      where ticket_hash = ${ticketHash} and status = 'REQUESTED'
        and expires_at > now()
      returning id as "operationId", action
    `)
    if (!redeemed.rows.length) return c.json({ error: 'stale_ticket' }, 409)
    return c.json(redeemed.rows[0])
  })

  app.post('/result', zValidator('json', resultSchema), async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const body = c.req.valid('json')
    const updated = await db.execute(sql`
      with run as (
        update repository_operation_runs set
          status = ${body.status},
          execution_name = ${body.executionName ?? null},
          error_code = ${body.errorCode ?? null},
          updated_at = now()
        where id = ${body.operationId} and status = 'DISPATCHING'
        returning id, actor_id, action
      ), audit as (
        insert into audit_events (actor_id, action, entity_type, entity_id, context)
        select actor_id, 'repository_operation.' || lower(${body.status}),
          'repository_operation', id::text,
          jsonb_build_object('operation', action, 'executionName', ${body.executionName ?? null}::text,
            'errorCode', ${body.errorCode ?? null}::text)
        from run
      ) select id from run
    `)
    if (!updated.rows.length) return c.json({ error: 'stale_operation' }, 409)
    return c.json({ ok: true })
  })

  return app
}
