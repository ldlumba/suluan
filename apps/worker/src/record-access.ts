import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app-context'
import { createDb } from './db'
import { effectiveVisibilityLevel } from './visibility'
import { prepareSubmissionKeywords } from './keywords'
import { findAbstractCandidate } from './abstract-candidate'

const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  schoolId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  state: z.enum(['active', 'withdrawn']).default('active'),
  sort: z
    .enum(['title', 'title_desc', 'newest', 'oldest', 'program', 'access'])
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
const keywordsSchema = z
  .object({
    keywords: z.array(z.string()).max(5),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => Number.isFinite(Date.parse(v))),
  })
  .strict()
const abstractSchema = z
  .object({
    abstract: z.string().trim().min(1).max(10_000),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => Number.isFinite(Date.parse(v))),
  })
  .strict()
const lifecycleSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('withdraw'),
      reason: z.string().trim().min(1).max(2000),
      expectedUpdatedAt: z
        .string()
        .refine((v) => Number.isFinite(Date.parse(v))),
    })
    .strict(),
  z
    .object({
      action: z.literal('reinstate'),
      reason: z.string().trim().min(1).max(2000),
      expectedUpdatedAt: z
        .string()
        .refine((v) => Number.isFinite(Date.parse(v))),
      visibility: z.enum(['PUBLIC', 'UA_ONLY', 'RESTRICTED']),
      embargoUntil: z.iso.date().nullable(),
    })
    .strict()
    .refine(
      (v) =>
        v.embargoUntil === null ||
        (v.visibility !== 'PUBLIC' &&
          v.embargoUntil > new Date().toISOString().slice(0, 10)),
      { message: 'Auto-lift requires restricted access and a future date.' },
    ),
])

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
    const { q, schoolId, courseId, page, sort, state } = c.req.valid('query')
    const ordering = {
      title: sql`lower(r.title) asc, r.id asc`,
      title_desc: sql`lower(r.title) desc, r.id asc`,
      newest: sql`r.created_at desc, r.id asc`,
      oldest: sql`r.created_at asc, r.id asc`,
      program: sql`lower(course.name) asc nulls last, lower(r.title) asc, r.id asc`,
      access: sql`case ${effectiveVisibilityLevel('r')} when 'PUBLIC' then 0 when 'UA_ONLY' then 1 else 2 end, lower(r.title) asc, r.id asc`,
    }[sort]
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`
    const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      select r.id, r.title, r.year, r.visibility, r.embargo_until::text as "embargoUntil", r.withdrawn_at as "withdrawnAt",
        ${effectiveVisibilityLevel('r')} as "effectiveVisibility",
        r.updated_at::text as "updatedAt", (r.abstract_approved_at is not null) as "abstractApproved", school.name as "schoolName", course.name as "courseName",
        coalesce((select array_agg(k.display_name order by rk.position, k.id)
          from research_keywords rk join keywords k on k.id = rk.keyword_id where rk.record_id = r.id), '{}'::text[]) as keywords
      from research_records r join submissions s on s.id = r.submission_id
      left join schools school on school.id = s.school_id
      left join courses course on course.id = s.course_id
      where s.status = 'ACCEPTED' and (${state} = 'withdrawn' and r.withdrawn_at is not null or ${state} = 'active' and r.withdrawn_at is null)
        and (${q} = '' or r.title ilike ${pattern})
        and (${schoolId ?? null}::uuid is null or s.school_id = ${schoolId ?? null}::uuid)
        and (${courseId ?? null}::uuid is null or s.course_id = ${courseId ?? null}::uuid)
      order by ${ordering} limit 21 offset ${(page - 1) * 20}
    `)
    return c.json({
      items: rows.rows.slice(0, 20),
      hasMore: rows.rows.length > 20,
    })
  })
  app.get(
    '/:id/abstract',
    zValidator('param', z.object({ id: z.string().uuid() })),
    async (c) => {
      const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      select r.abstract, (r.abstract_approved_at is not null) as approved,
        r.updated_at::text as "updatedAt", j.status as "processingStatus",
        case when j.status = 'EXTRACTED' then left(j.result->>'text', 50000) else null end as source
      from research_records r join submissions s on s.id = r.submission_id
      left join processing_jobs j on j.record_id = r.id
      where r.id = ${c.req.valid('param').id}::uuid and s.status = 'ACCEPTED' and r.withdrawn_at is null
    `)
      if (!rows.rows.length) return c.json({ error: 'not_found' }, 404)
      const row = rows.rows[0] as {
        abstract: string | null
        approved: boolean
        updatedAt: string
        processingStatus: string | null
        source: string | null
      }
      return c.json({
        abstract: row.abstract,
        approved: row.approved,
        updatedAt: row.updatedAt,
        processingStatus: row.processingStatus,
        candidate: row.approved
          ? null
          : findAbstractCandidate(row.source ?? ''),
      })
    },
  )
  app.patch(
    '/:id/abstract',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', abstractSchema),
    async (c) => {
      const body = c.req.valid('json')
      const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      with target as materialized (
        select r.id from research_records r join submissions s on s.id = r.submission_id
        where r.id = ${c.req.valid('param').id}::uuid and s.status = 'ACCEPTED'
          and r.withdrawn_at is null and r.updated_at = ${body.expectedUpdatedAt}::timestamptz
        for update of r
      ), changed as (
        update research_records r set abstract = ${body.abstract}, abstract_approved_at = clock_timestamp(), updated_at = clock_timestamp()
        from target t where r.id = t.id returning r.id
      ), audited as (
        insert into audit_events (actor_id, action, entity_type, entity_id)
        select ${c.get('profile').id}::uuid, 'record.abstract_approved', 'research_record', id::text from changed returning id
      ) select id from changed where exists (select 1 from audited)
    `)
      return rows.rows.length
        ? c.json({ ok: true })
        : c.json(
            {
              error: 'stale_record',
              message: 'This paper changed. Refresh and try again.',
            },
            409,
          )
    },
  )
  app.patch(
    '/:id/keywords',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', keywordsSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const prepared = prepareSubmissionKeywords(body.keywords)
      if ('error' in prepared) return c.json({ error: 'invalid_keywords' }, 400)
      const newTerms = JSON.stringify(
        prepared.keywords.map((k, position) => ({ ...k, position })),
      )
      const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      with target as materialized (
        select r.id,
          coalesce((select jsonb_agg(k.display_name order by rk.position, k.id)
            from research_keywords rk join keywords k on k.id = rk.keyword_id where rk.record_id = r.id), '[]'::jsonb) as old_keywords
        from research_records r join submissions s on s.id = r.submission_id
        where r.id = ${id}::uuid and s.status = 'ACCEPTED' and r.withdrawn_at is null
          and r.updated_at = ${body.expectedUpdatedAt}::timestamptz
        for update of r
      ), changed as (
        update research_records r set updated_at = clock_timestamp() from target t
        where r.id = t.id returning r.id
      ), terms as (
        insert into keywords (normalized_name, display_name)
        select k.normalized, k.term from changed c
        cross join jsonb_to_recordset(${newTerms}::jsonb) as k(term text, normalized text, position integer)
        order by k.normalized
        on conflict (normalized_name) do update set display_name = keywords.display_name
        returning id, normalized_name
      ), removed as (
        delete from research_keywords rk using changed c
        where rk.record_id = c.id and not exists (
          select 1 from keywords existing
          join jsonb_to_recordset(${newTerms}::jsonb) as k(term text, normalized text, position integer)
            on k.normalized = existing.normalized_name
          where existing.id = rk.keyword_id
        ) returning rk.id
      ), linked as (
        insert into research_keywords (record_id, keyword_id, position)
        select c.id, t.id, k.position from changed c
        cross join jsonb_to_recordset(${newTerms}::jsonb) as k(term text, normalized text, position integer)
        join terms t on t.normalized_name = k.normalized
        on conflict (record_id, keyword_id) do update set position = excluded.position
        returning id
      ), audited as (
        insert into audit_events (actor_id, action, entity_type, entity_id, context)
        select ${c.get('profile').id}::uuid, 'record.keywords_changed', 'research_record', t.id::text,
          jsonb_build_object('oldKeywords', t.old_keywords, 'newKeywords', ${JSON.stringify(prepared.keywords.map((k) => k.term))}::jsonb)
        from target t join changed c on c.id = t.id returning id
      ) select id from changed where exists (select 1 from audited)
    `)
      if (!rows.rows.length)
        return c.json(
          {
            error: 'stale_record',
            message: 'This paper changed. Refresh and try again.',
          },
          409,
        )
      return c.json({ ok: true })
    },
  )
  app.patch(
    '/:id/lifecycle',
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator('json', lifecycleSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const withdrawing = body.action === 'withdraw'
      const visibility = body.action === 'reinstate' ? body.visibility : null
      const embargoUntil =
        body.action === 'reinstate' ? body.embargoUntil : null
      const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      with target as materialized (
        select r.id, r.visibility, r.embargo_until from research_records r
        join submissions s on s.id = r.submission_id
        where r.id = ${id}::uuid and s.status = 'ACCEPTED'
          and r.updated_at = ${body.expectedUpdatedAt}::timestamptz
          and (${withdrawing}::boolean = (r.withdrawn_at is null))
        for update of r
      ), changed as (
        update research_records r set
          withdrawn_at = case when ${withdrawing}::boolean then clock_timestamp() else null end,
          lifecycle_version = r.lifecycle_version + 1,
          visibility = case when ${withdrawing}::boolean then r.visibility else ${visibility}::record_visibility end,
          embargo_until = case when ${withdrawing}::boolean then r.embargo_until else ${embargoUntil}::date end,
          updated_at = clock_timestamp()
        from target t where r.id = t.id returning r.id
      ), canceled_jobs as (
        update processing_jobs j set status = 'QUEUED', claim_token = null,
          lease_until = null, error_code = null, updated_at = now()
        from changed c where j.record_id = c.id and j.status = 'PROCESSING'
        returning j.id
      ), canceled_claims as (
        update embedding_claims ec set used_at = now() from changed c
        where ec.kind = 'prep' and ec.used_at is null
          and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(ec.payload) = 'array' then ec.payload else '[]'::jsonb end) as item where item->>'recordId' = c.id::text)
        returning ec.id
      ), audited as (
        insert into audit_events (actor_id, action, entity_type, entity_id, context)
        select ${c.get('profile').id}::uuid, ${withdrawing ? 'record.withdrawn' : 'record.reinstated'}, 'research_record', t.id::text,
          jsonb_build_object('reason', ${body.reason}::text, 'oldVisibility', t.visibility, 'oldEmbargoUntil', t.embargo_until,
            'newVisibility', ${visibility}::text, 'newEmbargoUntil', ${embargoUntil}::text)
        from target t join changed ch on ch.id = t.id returning id
      ) select id from changed where exists (select 1 from audited)
    `)
      if (!rows.rows.length)
        return c.json(
          {
            error: 'stale_or_unchanged',
            message: 'This paper changed. Refresh and try again.',
          },
          409,
        )
      return c.json({ ok: true })
    },
  )
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
        where r.id = ${id}::uuid and s.status = 'ACCEPTED' and r.withdrawn_at is null
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
