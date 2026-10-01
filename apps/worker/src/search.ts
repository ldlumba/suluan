import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '@suluan/db/schema'
import type { AppContext } from './app'
import { createDb } from './db'
import { CHUNKER_VERSION, chunkText } from './chunking'
import {
  effectiveVisibility,
  effectiveVisibilityLevel,
  viewerRoleFor,
  type ViewerRole,
} from './visibility'
import {
  batches,
  embedTexts,
  EmbeddingError,
  isSemanticEnabled,
  toVectorLiteral,
} from './embeddings'
import { consumeQuota, consumeQueryQuota, DEV_LIMITS } from './quota'

const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
})
const indexSchema = z.object({ recordId: z.string().uuid().optional() })
const PAGE_SIZE = 10
/** Bounded per-call batch; the production pipeline prepares per paper. */
const INDEX_BATCH = 10
/** Semantic preparation is operator-triggered, so it is bounded hard. */
const EMBED_PAPER_BATCH = 2
const EMBED_INPUT_BATCH = 100

/**
 * Keyword discovery. Public by default (owner-approved 2026-10-01): accepted
 * PUBLIC records are readable without an account, UA_ONLY requires a signed-in
 * UA account, and RESTRICTED stays manager-only. Preparation remains an
 * operator action (manager-only) because it writes keyword snapshots.
 */
export function searchRoutes(
  optionalAuth: MiddlewareHandler<AppContext>,
  requireAuth: MiddlewareHandler<AppContext>,
  requireManager: MiddlewareHandler<AppContext>,
) {
  const app = new Hono<AppContext>()

  app.get(
    '/records',
    optionalAuth,
    zValidator('query', querySchema),
    async (c) => {
      const { q, page } = c.req.valid('query')
      const db = createDb(c.env.DATABASE_URL)
      const profile = c.get('profile')
      const viewer = viewerRoleFor(profile?.role ?? null)
      const rows = await db.execute(sql`
        with query as (select websearch_to_tsquery('simple', ${q}) as terms),
        eligible as (
          select r.id, r.title, r.submission_id, s.authors, s.year, i.id as index_id,
            case when i.id is not null then 'READY'
              when j.status = 'FAILED' then 'FAILED' else 'PENDING' end as full_text_status,
            ${visibilityCase()} as visibility,
            to_tsvector('simple', r.title || ' ' || coalesce(s.authors, '')
              || ' ' || coalesce(s.year, '')) as metadata
          from research_records r join submissions s on s.id = r.submission_id
          left join processing_jobs j on j.record_id = r.id
          left join keyword_indexes i on i.record_id = r.id
            and i.extraction_claim_token = j.claim_token
            and i.chunker_version = ${CHUNKER_VERSION} and j.status = 'EXTRACTED'
          where s.status = 'ACCEPTED' and ${visibilityPredicate(viewer)}
        )
        select e.id, e.title, e.submission_id as "submissionId", e.authors, e.year,
          e.visibility, e.full_text_status as "fullTextStatus",
          left(best.content, 400) as snippet
        from eligible e cross join query
        left join lateral (
          select d.content, ts_rank_cd(d.search_vector, query.terms) as rank
          from document_chunks d where d.index_id = e.index_id
            and (${q} = '' or d.search_vector @@ query.terms)
          order by rank desc, d.ordinal limit 1
        ) best on true
        where ${q} = '' or e.metadata @@ query.terms or best.content is not null
        order by (ts_rank_cd(e.metadata, query.terms) * 2 + coalesce(best.rank, 0)) desc, e.id
        limit ${PAGE_SIZE + 1} offset ${(page - 1) * PAGE_SIZE}
      `)
      // Anonymous results are identical for everyone and short-lived
      // cacheable; authenticated results depend on role and must not be stored.
      c.header(
        'Cache-Control',
        viewer === 'PUBLIC' ? 'public, max-age=30' : 'private, no-store',
      )
      return c.json({
        items: rows.rows.slice(0, PAGE_SIZE),
        page,
        hasMore: rows.rows.length > PAGE_SIZE,
      })
    },
  )

  app.post(
    '/index',
    requireAuth,
    requireManager,
    zValidator('json', indexSchema),
    async (c) => {
    const { recordId } = c.req.valid('json')
    const db = createDb(c.env.DATABASE_URL)
    const candidates = await db.execute(sql`
      select r.id, j.claim_token as "claimToken", j.result
      from research_records r join submissions s on s.id = r.submission_id
      join processing_jobs j on j.record_id = r.id
      where s.status = 'ACCEPTED' and j.status = 'EXTRACTED'
        and (${recordId ?? null}::uuid is null or r.id = ${recordId ?? null}::uuid)
        and j.claim_token is not null and not exists (
          select 1 from keyword_indexes i where i.record_id = r.id
            and i.extraction_claim_token = j.claim_token
            and i.chunker_version = ${CHUNKER_VERSION}
        ) order by r.id limit ${INDEX_BATCH + 1}
    `)
    let indexed = 0
    for (const row of candidates.rows.slice(0, INDEX_BATCH)) {
      const source = row.result as { text: string; sha256: string }
      const chunks = chunkText(source.text)
      if (!chunks.length) continue
      const result = await db.execute(sql`
        with snapshot as (
          insert into keyword_indexes
            (record_id, extraction_claim_token, chunker_version, source_sha256)
          select r.id, j.claim_token, ${CHUNKER_VERSION}, ${source.sha256}
          from research_records r join submissions s on s.id = r.submission_id
          join processing_jobs j on j.record_id = r.id
          where r.id = ${row.id} and s.status = 'ACCEPTED' and j.status = 'EXTRACTED'
            and j.claim_token = ${row.claimToken}
            and j.result = ${JSON.stringify(row.result)}::jsonb
          on conflict (record_id, extraction_claim_token, chunker_version) do nothing
          returning id
        ), chunks as (
          insert into document_chunks
            (index_id, ordinal, start_offset, end_offset, content)
          select snapshot.id, x.ordinal, x."startOffset", x."endOffset", x.content
          from snapshot, jsonb_to_recordset(${JSON.stringify(chunks)}::jsonb)
            as x(ordinal integer, "startOffset" integer, "endOffset" integer, content text)
        ), audit as (
          insert into audit_events (actor_id, action, entity_type, entity_id)
          select ${c.get('profile').id}, 'keyword_index.created', 'research_record',
            ${row.id}::text
          from snapshot
        ) select id from snapshot
      `)
      indexed += result.rows.length
    }
    c.header('Cache-Control', 'private, no-store')
    return c.json({ indexed, hasMore: candidates.rows.length > INDEX_BATCH })
  })

  /**
   * Semantic search. Public by default like keyword search, and filtered through
   * the SAME `effectiveVisibility` predicate so search and download cannot drift
   * apart. Restricted papers are embedded but stay hidden: visibility is a read
   * policy, not an indexing decision, and an embargo that later lifts must not
   * require a re-embed.
   *
   * Fails closed to keyword, never to an error: a missing key, an exhausted
   * quota, or an upstream failure returns keyword results with a
   * `semanticStatus` explaining the degradation. Quota is consumed BEFORE the
   * paid call, per the AI-guardrail rule.
   */
  app.get(
    '/semantic',
    optionalAuth,
    zValidator('query', querySchema),
    async (c) => {
      const { q, page } = c.req.valid('query')
      const db = createDb(c.env.DATABASE_URL)
      const profile = c.get('profile')
      const viewer = viewerRoleFor(profile?.role ?? null)
      c.header(
        'Cache-Control',
        viewer === 'PUBLIC' ? 'public, max-age=30' : 'private, no-store',
      )

      // An empty query has nothing to embed; defer to keyword listing.
      if (!q) {
        return c.json({
          items: [],
          page,
          hasMore: false,
          semanticStatus: 'empty_query' as const,
        })
      }
      if (!isSemanticEnabled(c.env.GEMINI_API_KEY)) {
        return c.json({
          items: [],
          page,
          hasMore: false,
          semanticStatus: 'unconfigured' as const,
        })
      }
      const quota = await consumeQueryQuota(db, {
        viewer,
        profileId: profile?.id ?? null,
      })
      if (!quota.allowed) {
        // Do not call Gemini. Keyword results are served by the caller.
        return c.json({
          items: [],
          page,
          hasMore: false,
          semanticStatus: 'quota_exhausted' as const,
          reason: quota.reason,
        })
      }

      let vector: number[]
      try {
        // RETRIEVAL_QUERY (not DOCUMENT) is what makes asymmetric retrieval work.
        ;[vector] = await embedTexts(
          c.env.GEMINI_API_KEY as string,
          [q],
          'RETRIEVAL_QUERY',
        )
      } catch (err) {
        return c.json({
          items: [],
          page,
          hasMore: false,
          semanticStatus:
            err instanceof EmbeddingError ? 'provider_error' : ('unavailable' as const),
          reason:
            err instanceof EmbeddingError
              ? err.message
              : 'Semantic search is temporarily unavailable.',
        })
      }

      // Best distance per record: chunks of the same paper are not separate
      // results, they are evidence for one result.
      const queryVector = toVectorLiteral(vector)
      const rows = await db.execute(sql`
        with best as (
          select e.semantic_index_id, k.record_id,
            min(e.embedding <=> cast(${queryVector} as vector)) as distance,
            (array_agg(d.content order by e.embedding <=> cast(${queryVector} as vector)))[1] as snippet
          from document_embeddings e
          join document_chunks d on d.id = e.chunk_id
          join semantic_indexes si on si.id = e.semantic_index_id
          join keyword_indexes k on k.id = si.keyword_index_id
          where si.model = ${EMBEDDING_MODEL} and si.dimensions = ${EMBEDDING_DIMS}
            and si.chunker_version = ${CHUNKER_VERSION}
          group by e.semantic_index_id, k.record_id
        ), ranked as (
          select distinct on (b.record_id) b.record_id, b.distance, b.snippet
          from best b
          join research_records r on r.id = b.record_id
          join submissions s on s.id = r.submission_id
          where s.status = 'ACCEPTED' and ${visibilityPredicate(viewer)}
          order by b.record_id, b.distance asc
        )
        select r.id, r.title, r.submission_id as "submissionId", s.authors, s.year,
          ${visibilityCase()} as visibility,
          'READY' as "fullTextStatus",
          left(ranked.snippet, 400) as snippet,
          ranked.distance
        from ranked
        join research_records r on r.id = ranked.record_id
        join submissions s on s.id = r.submission_id
        order by ranked.distance asc, r.id
        limit ${PAGE_SIZE + 1} offset ${(page - 1) * PAGE_SIZE}
      `)
      return c.json({
        items: rows.rows.slice(0, PAGE_SIZE),
        page,
        hasMore: rows.rows.length > PAGE_SIZE,
        semanticStatus: 'ready' as const,
      })
    },
  )

  /**
   * Semantic preparation (manager-only). Embeds the chunks of keyword snapshots
   * that have no vectors for the CURRENT model and width yet.
   *
   * Idempotent twice over: the snapshot upsert always returns its id and the
   * vector insert relies on UNIQUE(chunk_id), so a retried or concurrent call
   * cannot duplicate embeddings. Candidates are missing CHUNKS, not missing
   * snapshots — a partially embedded paper must remain eligible. Quota is
   * consumed per batch immediately before the paid call, and the batch is sized
   * to the remaining daily input budget so one call cannot blow the cap.
   */
  app.post(
    '/semantic/prepare',
    requireAuth,
    requireManager,
    zValidator('json', indexSchema),
    async (c) => {
      const { recordId } = c.req.valid('json')
      if (!isSemanticEnabled(c.env.GEMINI_API_KEY)) {
        return c.json({ error: 'semantic_not_configured' }, 503)
      }
      const db = createDb(c.env.DATABASE_URL)
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
        limit ${EMBED_INPUT_BATCH}
      `)
      if (candidates.rows.length === 0) {
        c.header('Cache-Control', 'private, no-store')
        return c.json({ embedded: 0, papers: 0, hasMore: false })
      }
      const rows = candidates.rows as {
        keyword_index_id: string
        record_id: string
        source_sha256: string
        chunk_id: string
        content: string
      }[]
      const records = [...new Set(rows.map((r) => r.record_id))]
      // Bound the per-call paper count as well as the input count.
      const allowed = new Set(records.slice(0, EMBED_PAPER_BATCH))
      const targets = rows.filter((r) => allowed.has(r.record_id))
      const remaining = Math.max(
        0,
        Math.min(targets.length, DEV_LIMITS.maxInputs),
      )
      const work = targets.slice(0, remaining)

      let embedded = 0
      for (const group of batches(work)) {
        const quota = await consumeQuota(
          db,
          'dev_global',
          'all',
          1,
          group.length,
          DEV_LIMITS,
        )
        if (!quota.allowed) {
          return c.json({
            embedded,
            papers: 0,
            hasMore: true,
            stopped: quota.reason,
          })
        }
        let vectors: number[][]
        try {
          vectors = await embedTexts(
            c.env.GEMINI_API_KEY as string,
            group.map((row) => row.content),
            'RETRIEVAL_DOCUMENT',
          )
        } catch (err) {
          // A provider failure must not surface as an opaque 500: this is an
          // operator action, so report what happened and how far it got. The
          // quota was already charged for this batch, which is the safe
          // direction — a retry storm still cannot exceed the daily cap.
          return c.json(
            {
              error: 'embedding_provider_failed',
              embedded,
              reason:
                err instanceof EmbeddingError
                  ? err.message
                  : 'Embedding provider is unavailable.',
            },
            502,
          )
        }
        const payload = group.map((row, offset) => ({
          keywordIndexId: row.keyword_index_id,
          recordId: row.record_id,
          sourceSha256: row.source_sha256,
          chunkId: row.chunk_id,
          embedding: toVectorLiteral(vectors[offset]),
        }))
        const inserted = await db.execute(sql`
          with input as (
            select * from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
              as x(
                "keywordIndexId" uuid,
                "recordId" uuid,
                "sourceSha256" text,
                "chunkId" uuid,
                embedding text
              )
          ), snapshots as (
            insert into semantic_indexes
              (keyword_index_id, model, dimensions, chunker_version,
                source_sha256, created_by)
            select distinct "keywordIndexId", ${EMBEDDING_MODEL}::text,
              ${EMBEDDING_DIMS}::integer, ${CHUNKER_VERSION}::text,
              "sourceSha256", ${c.get('profile').id}::uuid
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
          ), audit as (
            insert into audit_events
              (actor_id, action, entity_type, entity_id)
            select distinct ${c.get('profile').id}::uuid,
              'semantic_index.embedded',
              'research_record', input."recordId"::text
            from vectors
            join input on input."chunkId" = vectors.chunk_id
          )
          select id from vectors
        `)
        embedded += inserted.rows.length
      }
      c.header('Cache-Control', 'private, no-store')
      return c.json({
        embedded,
        papers: allowed.size,
        hasMore: candidates.rows.length > work.length,
      })
    },
  )

  return app
}

/**
 * Effective visibility case expression and row filter. Both delegate to the
 * shared policy module so search and download can never drift apart on the
 * embargo rule.
 */
function visibilityCase() {
  return effectiveVisibilityLevel('r')
}

/** Row filter for what a viewer may see at all. Managers see everything. */
function visibilityPredicate(viewer: ViewerRole) {
  return effectiveVisibility(viewer, 'r').rowVisible
}
