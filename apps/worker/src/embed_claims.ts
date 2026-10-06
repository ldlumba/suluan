import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '@suluan/db/schema'
import type { AppContext } from './app'
import { createDb } from './db'
import { CHUNKER_VERSION } from './chunking'
import { normalizeVector, toVectorLiteral } from './embeddings'
import { consumeQuota, embeddingLimits } from './quota'
import { EMBED_INPUT_BATCH, EMBED_PAPER_BATCH } from './search'
import {
  semanticChunkDistancesByVector,
  semanticSearchByVector,
} from './search'
import type { ViewerRole } from './visibility'

const claimSchema = z
  .object({ recordId: z.string().uuid().optional() })
  .strict()
const vectorSchema = z.object({
  chunkId: z.string().uuid(),
  values: z.array(z.number()).max(4096),
})
const resultSchema = z
  .object({
    claimToken: z.string().uuid(),
    vectors: z.array(vectorSchema).min(1).max(EMBED_INPUT_BATCH),
  })
  .strict()
const queryClaimSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    viewer: z.enum(['PUBLIC', 'UA_USER', 'MANAGER']).default('MANAGER'),
    page: z.number().int().min(1).max(1000).default(1),
    includeDiagnostics: z.boolean().default(false),
  })
  .strict()
const queryResultSchema = z
  .object({
    claimToken: z.string().uuid(),
    values: z.array(z.number()).max(4096),
  })
  .strict()

interface ClaimItem {
  chunkId: string
  keywordIndexId: string
  recordId: string
  sourceSha256: string
  content: string
}

/**
 * Region-stable embedding pull API (2026-10-06).
 *
 * Cloudflare Worker egress cannot reliably satisfy Gemini's location policy,
 * so paid embedding calls originate from a pinned-region Cloud Run Job. The
 * Job holds no Neon/R2 credentials beyond this workload-scoped boundary: it
 * presents the same audience-pinned Google ID token as extraction, never a
 * manager profile or shared secret.
 *
 * Quota is consumed server-side in the claim step, before any paid call, and
 * is retained on provider failure — the same rule as direct preparation. The
 * claim token is single-use with a ten-minute expiry; the result step
 * validates the token, the exact chunk set, and vector geometry, then writes
 * through the same idempotent snapshot upsert (`DO UPDATE ... RETURNING id`)
 * and `ON CONFLICT (chunk_id) DO NOTHING` vector insert as direct
 * preparation. Chunk text travels only in the claim response (Job memory);
 * the claim row stores chunk IDs, never content.
 */
export function serviceEmbedRoutes(authorize: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>()
  app.use('*', authorize)
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  // Evaluation-only query claim/result flow. The pinned Cloud Run runner
  // claims quota before calling Gemini, then returns the vector for the exact
  // same visibility-aware ranking SQL used by the public route.
  app.post('/query/claim', zValidator('json', queryClaimSchema), async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const body = c.req.valid('json')
    const quota = await consumeQuota(
      db,
      'dev_global',
      'all',
      1,
      1,
      embeddingLimits(
        c.env.EMBEDDING_DAILY_REQUEST_LIMIT,
        c.env.EMBEDDING_DAILY_INPUT_LIMIT,
      ),
    )
    if (!quota.allowed)
      return c.json({ error: 'quota_exhausted', reason: quota.reason }, 429)
    const claimToken = crypto.randomUUID()
    const inserted = await db.execute(sql`
      insert into embedding_claims
        (claim_token, kind, inputs, payload, expires_at)
      values (${claimToken}, 'query', 1,
        ${JSON.stringify({
          query: body.query,
          viewer: body.viewer,
          page: body.page,
          includeDiagnostics: body.includeDiagnostics,
        })}::jsonb,
        now() + interval '10 minutes')
      returning id as "claimId"
    `)
    return c.json({
      claimId: (inserted.rows[0] as { claimId: string }).claimId,
      claimToken,
      query: body.query,
    })
  })

  app.post(
    '/query/result',
    zValidator('json', queryResultSchema),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const body = c.req.valid('json')
      const claims = await db.execute(sql`
      select payload, used_at as "usedAt"
      from embedding_claims
      where claim_token = ${body.claimToken}
        and kind = 'query' and expires_at > now()
      limit 1
    `)
      if (
        !claims.rows.length ||
        (claims.rows[0] as { usedAt: string | null }).usedAt
      )
        return c.json({ error: 'stale_claim' }, 409)
      const claim = claims.rows[0] as {
        payload: {
          viewer: ViewerRole
          page: number
          includeDiagnostics?: boolean
        }
      }
      let vector: number[]
      try {
        vector = normalizeVector(body.values)
        if (
          vector.length !== 768 ||
          vector.some((value) => !Number.isFinite(value))
        )
          throw new Error('invalid vector')
      } catch {
        return c.json({ error: 'invalid_vector' }, 422)
      }
      await db.execute(sql`
      update embedding_claims set used_at = now()
      where claim_token = ${body.claimToken} and used_at is null
    `)
      const result = await semanticSearchByVector(
        db,
        claim.payload.viewer,
        vector,
        claim.payload.page,
      )
      return c.json({
        ...result,
        ...(claim.payload.includeDiagnostics
          ? {
              chunkDistances: await semanticChunkDistancesByVector(
                db,
                claim.payload.viewer,
                vector,
              ),
            }
          : {}),
        semanticStatus: 'ready' as const,
      })
    },
  )

  app.post('/claim', zValidator('json', claimSchema), async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    // Optional per-record scoping for tests and single-paper recovery. The
    // Cloud Run Job omits it to drain the whole missing-chunk backlog.
    const { recordId } = c.req.valid('json')
    const candidates = await db.execute(sql`
      select k.id as keyword_index_id, k.record_id, k.source_sha256,
        d.id as chunk_id, d.content
      from keyword_indexes k
      join document_chunks d on d.index_id = k.id
      join research_records r on r.id = k.record_id
      join submissions s on s.id = r.submission_id
      where s.status = 'ACCEPTED' and k.chunker_version = ${CHUNKER_VERSION}
        and (${recordId ?? null}::uuid is null or k.record_id = ${recordId ?? null}::uuid)
        and not exists (
          select 1 from document_embeddings e where e.chunk_id = d.id
        )
      order by k.record_id, d.ordinal
      limit ${EMBED_INPUT_BATCH + 1}
    `)
    if (candidates.rows.length === 0) return c.body(null, 204)
    const rows = candidates.rows as {
      keyword_index_id: string
      record_id: string
      source_sha256: string
      chunk_id: string
      content: string
    }[]
    const records = [...new Set(rows.map((r) => r.record_id))]
    const allowed = new Set(records.slice(0, EMBED_PAPER_BATCH))
    const work = rows
      .filter((r) => allowed.has(r.record_id))
      .slice(0, EMBED_INPUT_BATCH)

    const limits = embeddingLimits(
      c.env.EMBEDDING_DAILY_REQUEST_LIMIT,
      c.env.EMBEDDING_DAILY_INPUT_LIMIT,
    )
    const quota = await consumeQuota(
      db,
      'dev_global',
      'all',
      1,
      work.length,
      limits,
    )
    if (!quota.allowed) {
      return c.json({ error: 'quota_exhausted', reason: quota.reason }, 429)
    }

    const claimToken = crypto.randomUUID()
    const items: ClaimItem[] = work.map((row) => ({
      chunkId: row.chunk_id,
      keywordIndexId: row.keyword_index_id,
      recordId: row.record_id,
      sourceSha256: row.source_sha256,
      content: row.content,
    }))
    // Chunk text travels only in the claim response (Job memory). The stored
    // row keeps chunk IDs so the result step can verify the exact set.
    const stored = items.map((item) => ({
      chunkId: item.chunkId,
      keywordIndexId: item.keywordIndexId,
      recordId: item.recordId,
      sourceSha256: item.sourceSha256,
    }))
    const inserted = await db.execute(sql`
      insert into embedding_claims
        (claim_token, kind, inputs, payload, expires_at)
      values (${claimToken}, 'prep', ${items.length},
        ${JSON.stringify(stored)}::jsonb, now() + interval '10 minutes')
      returning id as "claimId"
    `)
    const claimId = (inserted.rows[0] as { claimId: string }).claimId
    return c.json({
      claimId,
      claimToken,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      hasMore: candidates.rows.length > work.length,
      items,
    })
  })

  app.post(
    '/result',
    bodyLimit({ maxSize: 4 * 1024 * 1024 }),
    zValidator('json', resultSchema),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const body = c.req.valid('json')
      const service = c.get('serviceIdentity').email
      const claims = await db.execute(sql`
        select id as "claimId", payload, used_at as "usedAt"
        from embedding_claims
        where claim_token = ${body.claimToken}
          and kind = 'prep' and expires_at > now()
        limit 1
      `)
      if (claims.rows.length === 0) return c.json({ error: 'stale_claim' }, 409)
      const claim = claims.rows[0] as {
        claimId: string
        payload: { chunkId: string }[]
        usedAt: string | null
      }
      if (claim.usedAt) return c.json({ error: 'stale_claim' }, 409)
      const claimedIds = new Set(claim.payload.map((item) => item.chunkId))
      const vectorIds = new Set(body.vectors.map((v) => v.chunkId))
      if (
        claimedIds.size !== vectorIds.size ||
        ![...claimedIds].every((id) => vectorIds.has(id))
      ) {
        return c.json({ error: 'claim_mismatch' }, 409)
      }

      let literals: { chunkId: string; literal: string }[]
      try {
        literals = body.vectors.map((v) => ({
          chunkId: v.chunkId,
          literal: toVectorLiteral(normalizeVector(v.values)),
        }))
      } catch {
        return c.json({ error: 'invalid_vector' }, 422)
      }
      const fullPayload = (
        claim.payload as unknown as Omit<ClaimItem, 'content'>[]
      ).map((item) => {
        const literal = literals.find((l) => l.chunkId === item.chunkId)
        return { ...item, embedding: literal?.literal ?? '' }
      })
      const inserted = await db.execute(sql`
        with input as (
          select * from jsonb_to_recordset(${JSON.stringify(fullPayload)}::jsonb)
            as x(
              "chunkId" uuid,
              "keywordIndexId" uuid,
              "recordId" uuid,
              "sourceSha256" text,
              embedding text
            )
        ), snapshots as (
          insert into semantic_indexes
            (keyword_index_id, model, dimensions, chunker_version,
              source_sha256, created_by)
          select distinct "keywordIndexId", ${EMBEDDING_MODEL}::text,
            ${EMBEDDING_DIMS}::integer, ${CHUNKER_VERSION}::text,
            "sourceSha256", null::uuid
          from input
          on conflict (keyword_index_id, model, dimensions) do update
            set created_by = semantic_indexes.created_by
          returning id, keyword_index_id
        ), vectors as (
          insert into document_embeddings
            (semantic_index_id, chunk_id, embedding)
          select snapshots.id, input."chunkId", cast(input.embedding as vector)
          from input
          join snapshots
            on snapshots.keyword_index_id = input."keywordIndexId"
          on conflict (chunk_id) do nothing
          returning id, chunk_id
        ), claimed as (
          update embedding_claims set used_at = now()
          where claim_token = ${body.claimToken} and used_at is null
        ), audit as (
          insert into audit_events
            (actor_id, action, entity_type, entity_id, context)
          select distinct null::uuid, 'semantic_index.embedded', 'research_record',
            input."recordId"::text,
            jsonb_build_object('serviceAccount', ${service}::text)
          from vectors
          join input on input."chunkId" = vectors.chunk_id
        )
        select id from vectors
      `)
      return c.json({ embedded: inserted.rows.length })
    },
  )

  return app
}
