import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app'
import { createDb } from './db'
import { CHUNKER_VERSION, chunkText } from './chunking'

const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
})
const PAGE_SIZE = 10

/** Restricted discovery preview. Publication/embargo policy remains TBD. */
export function searchRoutes(authorize: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>()
  app.use('*', authorize)
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })

  // Bounded operator-triggered backfill also handles newly extracted papers.
  // Queued extraction jobs are never claimed by this operation.
  app.post(
    '/index',
    zValidator('json', z.object({ recordId: z.string().uuid().optional() })),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const { recordId } = c.req.valid('json')
      const candidates = await db.execute(sql`
      select r.id, j.claim_token as "claimToken", j.result
      from research_records r join submissions s on s.id = r.submission_id
      join processing_jobs j on j.record_id = r.id
      where s.status = 'ACCEPTED' and j.status = 'EXTRACTED'
        and (${recordId ?? null}::uuid is null or r.id = ${recordId ?? null}::uuid)
        and j.claim_token is not null and not exists (
          select 1 from keyword_indexes i where i.record_id = r.id
            and i.extraction_claim_token = j.claim_token and i.chunker_version = ${CHUNKER_VERSION}
        ) order by r.id limit 11
    `)
      let indexed = 0
      for (const row of candidates.rows.slice(0, 10)) {
        const source = row.result as { text: string; sha256: string }
        const chunks = chunkText(source.text)
        if (!chunks.length) continue
        const result = await db.execute(sql`
        with snapshot as (
          insert into keyword_indexes (record_id, extraction_claim_token, chunker_version, source_sha256)
          select r.id, j.claim_token, ${CHUNKER_VERSION}, ${source.sha256}
          from research_records r join submissions s on s.id = r.submission_id
          join processing_jobs j on j.record_id = r.id
          where r.id = ${row.id} and s.status = 'ACCEPTED' and j.status = 'EXTRACTED'
            and j.claim_token = ${row.claimToken} and j.result = ${JSON.stringify(row.result)}::jsonb
          on conflict (record_id, extraction_claim_token, chunker_version) do nothing
          returning id
        ), chunks as (
          insert into document_chunks (index_id, ordinal, start_offset, end_offset, content)
          select snapshot.id, x.ordinal, x."startOffset", x."endOffset", x.content
          from snapshot, jsonb_to_recordset(${JSON.stringify(chunks)}::jsonb)
            as x(ordinal integer, "startOffset" integer, "endOffset" integer, content text)
        ), audit as (
          insert into audit_events (actor_id, action, entity_type, entity_id)
          select ${c.get('profile').id}, 'keyword_index.created', 'research_record', ${row.id}::text
          from snapshot
        ) select id from snapshot
      `)
        indexed += result.rows.length
      }
      return c.json({ indexed, hasMore: candidates.rows.length > 10 })
    },
  )

  app.get('/records', zValidator('query', querySchema), async (c) => {
    const { q, page } = c.req.valid('query')
    const db = createDb(c.env.DATABASE_URL)
    const rows = await db.execute(sql`
      with query as (select websearch_to_tsquery('simple', ${q}) as terms),
      eligible as (
        select r.id, r.title, r.submission_id, s.authors, s.year, i.id as index_id,
          case when i.id is not null then 'READY'
            when j.status = 'FAILED' then 'FAILED' else 'PENDING' end as full_text_status,
          to_tsvector('simple', r.title || ' ' || coalesce(s.authors, '') || ' ' || coalesce(s.year, '')) as metadata
        from research_records r join submissions s on s.id = r.submission_id
        left join processing_jobs j on j.record_id = r.id
        left join keyword_indexes i on i.record_id = r.id and i.extraction_claim_token = j.claim_token
          and i.chunker_version = ${CHUNKER_VERSION} and j.status = 'EXTRACTED'
        where s.status = 'ACCEPTED'
      )
      select e.id, e.title, e.submission_id as "submissionId", e.authors, e.year,
        e.full_text_status as "fullTextStatus", left(best.content, 400) as snippet
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
    return c.json({
      items: rows.rows.slice(0, PAGE_SIZE),
      page,
      hasMore: rows.rows.length > PAGE_SIZE,
    })
  })
  return app
}
