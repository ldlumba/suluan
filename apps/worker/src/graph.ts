import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from './app'
import { createDb } from './db'
import {
  cacheControlFor,
  effectiveVisibility,
  viewerRoleFor,
} from './visibility'

const neighborhoodSchema = z.object({
  type: z.literal('paper').default('paper'),
  id: z.string().uuid(),
  depth: z.coerce.number().int().min(1).max(2).default(2),
})
const countsSchema = z.object({
  groupBy: z.enum(['keyword', 'course', 'year']).default('keyword'),
})
const AGGREGATE_LIMIT = 20

type GraphNodeType =
  'paper' | 'author' | 'keyword' | 'course' | 'school' | 'year'

interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  recordId?: string
  normalizedName?: string
  center?: boolean
}

interface GraphEdge {
  id: string
  source: string
  target: string
  type:
    | 'AUTHORED_BY'
    | 'TAGGED_WITH'
    | 'IN_COURSE'
    | 'IN_SCHOOL'
    | 'PUBLISHED_IN'
    | 'SHARES_KEYWORD_WITH'
  weight?: number
}

interface PaperRow {
  id: string
  title: string
  year: number
  course_id: string | null
  course_name: string | null
  school_id: string | null
  school_name: string | null
  authors: { name: string; normalizedName: string }[]
  keywords: { id: string; label: string; normalizedName: string }[]
  shared_keywords: number
  shared_authors: number
  shared_course: number
}

const NODE_CAPS: Record<GraphNodeType, number> = {
  paper: 50,
  author: 30,
  keyword: 30,
  course: 20,
  school: 10,
  year: 20,
}

const authorNodeId = (name: string) => `author:${encodeURIComponent(name)}`

/** Build a bounded graph response from already visibility-filtered paper rows. */
export function buildNeighborhood(rows: PaperRow[], centerId: string) {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const counts = new Map<GraphNodeType, number>()
  let truncated = false
  const center = rows.find((paper) => paper.id === centerId)
  const centerAuthors = new Set(
    center?.authors.map((author) => author.normalizedName) ?? [],
  )
  const centerKeywords = new Set(
    center?.keywords.map((keyword) => keyword.id) ?? [],
  )

  const addNode = (node: GraphNode) => {
    if (nodeIds.has(node.id)) return true
    const count = counts.get(node.type) ?? 0
    if (count >= NODE_CAPS[node.type]) {
      truncated = true
      return false
    }
    nodes.push(node)
    nodeIds.add(node.id)
    counts.set(node.type, count + 1)
    return true
  }
  const addEdge = (edge: GraphEdge) => {
    if (
      edgeIds.has(edge.id) ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target)
    )
      return
    edges.push(edge)
    edgeIds.add(edge.id)
  }

  for (const paper of rows) {
    const paperId = `paper:${paper.id}`
    const isCenter = paper.id === centerId
    if (
      !addNode({
        id: paperId,
        type: 'paper',
        label: paper.title,
        recordId: paper.id,
        center: isCenter,
      })
    )
      continue

    // At depth 2, a related paper is reached through a shared author, keyword,
    // or course. Its unrelated metadata would be depth 3 and would turn a
    // useful ego graph into an unreadable fan-out.
    const visibleAuthors = isCenter
      ? paper.authors
      : paper.authors.filter((author) =>
          centerAuthors.has(author.normalizedName),
        )
    const visibleKeywords = isCenter
      ? paper.keywords
      : paper.keywords.filter((keyword) => centerKeywords.has(keyword.id))

    for (const author of visibleAuthors) {
      const id = authorNodeId(author.normalizedName)
      if (
        addNode({
          id,
          type: 'author',
          label: author.name,
          normalizedName: author.normalizedName,
        })
      )
        addEdge({
          id: `${paperId}:AUTHORED_BY:${id}`,
          source: paperId,
          target: id,
          type: 'AUTHORED_BY',
        })
    }
    for (const keyword of visibleKeywords) {
      const id = `keyword:${keyword.id}`
      if (
        addNode({
          id,
          type: 'keyword',
          label: keyword.label,
          normalizedName: keyword.normalizedName,
        })
      )
        addEdge({
          id: `${paperId}:TAGGED_WITH:${id}`,
          source: paperId,
          target: id,
          type: 'TAGGED_WITH',
        })
    }
    const sharesCenterCourse =
      paper.course_id !== null && paper.course_id === center?.course_id
    if (
      paper.course_id &&
      paper.course_name &&
      (isCenter || sharesCenterCourse)
    ) {
      const courseId = `course:${paper.course_id}`
      if (addNode({ id: courseId, type: 'course', label: paper.course_name }))
        addEdge({
          id: `${paperId}:IN_COURSE:${courseId}`,
          source: paperId,
          target: courseId,
          type: 'IN_COURSE',
        })
      if (paper.school_id && paper.school_name) {
        const schoolId = `school:${paper.school_id}`
        if (addNode({ id: schoolId, type: 'school', label: paper.school_name }))
          addEdge({
            id: `${courseId}:IN_SCHOOL:${schoolId}`,
            source: courseId,
            target: schoolId,
            type: 'IN_SCHOOL',
          })
      }
    }
    if (isCenter) {
      const yearId = `year:${paper.year}`
      if (addNode({ id: yearId, type: 'year', label: String(paper.year) }))
        addEdge({
          id: `${paperId}:PUBLISHED_IN:${yearId}`,
          source: paperId,
          target: yearId,
          type: 'PUBLISHED_IN',
        })
    }

    if (paper.id !== centerId && paper.shared_keywords > 0)
      addEdge({
        id: `paper:${centerId}:SHARES_KEYWORD_WITH:${paperId}`,
        source: `paper:${centerId}`,
        target: paperId,
        type: 'SHARES_KEYWORD_WITH',
        weight: paper.shared_keywords,
      })
  }

  return { nodes, edges, truncated, caps: NODE_CAPS }
}

export function graphRoutes(optionalAuth: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>()

  app.get(
    '/neighborhood',
    optionalAuth,
    zValidator('query', neighborhoodSchema),
    async (c) => {
      const { id, depth } = c.req.valid('query')
      const viewer = viewerRoleFor(c.get('profile')?.role ?? null)
      const attempted =
        c.req.header('authorization')?.startsWith('Bearer ') ?? false
      c.header('Cache-Control', cacheControlFor(viewer, attempted, 30))
      c.header('Vary', 'Authorization')
      const db = createDb(c.env.DATABASE_URL)

      // `visible` is the only paper source used by every subsequent hop. This
      // prevents a restricted paper from leaking as a related node or through
      // a shared-keyword count.
      const result = await db.execute(sql`
        with visible as (
          select r.id, r.title, r.year, s.course_id, course.name as course_name,
            s.school_id, school.name as school_name,
            coalesce(authors.items, '[]'::jsonb) as authors,
            coalesce(authors.normalized, '{}'::text[]) as author_names,
            coalesce(terms.items, '[]'::jsonb) as keywords,
            coalesce(terms.ids, '{}'::uuid[]) as keyword_ids
          from research_records r
          join submissions s on s.id = r.submission_id and s.status = 'ACCEPTED'
          left join courses course on course.id = s.course_id
          left join schools school on school.id = s.school_id
          left join lateral (
            select jsonb_agg(jsonb_build_object(
              'name', a.name,
              'normalizedName', lower(regexp_replace(trim(a.name), '\\s+', ' ', 'g'))
            ) order by a.position, a.id) as items,
            array_agg(lower(regexp_replace(trim(a.name), '\\s+', ' ', 'g'))
              order by a.position, a.id) as normalized
            from record_authors a where a.record_id = r.id
          ) authors on true
          left join lateral (
            select jsonb_agg(jsonb_build_object(
              'id', k.id, 'label', k.display_name,
              'normalizedName', k.normalized_name
            ) order by rk.position, rk.id) as items,
            array_agg(k.id order by rk.position, rk.id) as ids
            from research_keywords rk
            join keywords k on k.id = rk.keyword_id
            where rk.record_id = r.id
          ) terms on true
          where ${effectiveVisibility(viewer, 'r').rowVisible}
        ), center as (
          select * from visible where id = ${id}
        ), ranked as (
          select v.*,
            (select count(*)::integer from unnest(v.keyword_ids) as terms(term)
              where term = any(c.keyword_ids)) as shared_keywords,
            (select count(*)::integer from unnest(v.author_names) as names(author_name)
              where author_name = any(c.author_names)) as shared_authors,
            case when v.course_id is not null and v.course_id = c.course_id
              then 1 else 0 end as shared_course
          from visible v cross join center c
        )
        select * from ranked
        where id = ${id} or (${depth} = 2 and
          (shared_keywords > 0 or shared_authors > 0 or shared_course > 0))
        order by (id = ${id}) desc, shared_keywords desc, shared_authors desc,
          shared_course desc, lower(title), id
        limit ${NODE_CAPS.paper + 1}
      `)
      const rows = result.rows as unknown as PaperRow[]
      if (!rows.some((row) => row.id === id))
        return c.json({ error: 'not_found' }, 404)
      return c.json({ centerId: id, depth, ...buildNeighborhood(rows, id) })
    },
  )

  app.get(
    '/counts',
    optionalAuth,
    zValidator('query', countsSchema),
    async (c) => {
      const { groupBy } = c.req.valid('query')
      const viewer = viewerRoleFor(c.get('profile')?.role ?? null)
      const attempted =
        c.req.header('authorization')?.startsWith('Bearer ') ?? false
      c.header('Cache-Control', cacheControlFor(viewer, attempted, 30))
      c.header('Vary', 'Authorization')
      const db = createDb(c.env.DATABASE_URL)

      // Each aggregate starts from the same accepted + effective-visibility
      // relation. Counts never inspect intake-only, pending, rejected, or
      // viewer-hidden records, including the keyword-pair arithmetic.
      if (groupBy === 'keyword') {
        const result = await db.execute(sql`
          with visible as (
            select r.id
            from research_records r
            join submissions s on s.id = r.submission_id
              and s.status = 'ACCEPTED'
            where ${effectiveVisibility(viewer, 'r').rowVisible}
          ), grouped as (
            select k.id::text as id, k.display_name as label,
              count(distinct v.id)::integer as count
            from visible v
            join research_keywords rk on rk.record_id = v.id
            join keywords k on k.id = rk.keyword_id
            group by k.id, k.display_name
          ), paired as (
            select k1.id::text as "firstId", k1.display_name as "firstLabel",
              k2.id::text as "secondId", k2.display_name as "secondLabel",
              count(distinct v.id)::integer as count
            from visible v
            join research_keywords rk1 on rk1.record_id = v.id
            join research_keywords rk2 on rk2.record_id = v.id
              and rk1.keyword_id < rk2.keyword_id
            join keywords k1 on k1.id = rk1.keyword_id
            join keywords k2 on k2.id = rk2.keyword_id
            group by k1.id, k1.display_name, k2.id, k2.display_name
          )
          select
            (select count(*)::integer from visible) as "totalPapers",
            (select count(*)::integer from grouped) as "totalGroups",
            (select count(*)::integer from paired) as "totalPairs",
            coalesce((select jsonb_agg(to_jsonb(top_groups)) from (
              select id, label, count from grouped
              order by count desc, lower(label), id
              limit ${AGGREGATE_LIMIT}
            ) top_groups), '[]'::jsonb) as items,
            coalesce((select jsonb_agg(to_jsonb(top_pairs)) from (
              select "firstId", "firstLabel", "secondId", "secondLabel", count
              from paired
              order by count desc, lower("firstLabel"), lower("secondLabel"),
                "firstId", "secondId"
              limit ${AGGREGATE_LIMIT}
            ) top_pairs), '[]'::jsonb) as pairs
        `)
        const row = result.rows[0] as {
          totalPapers: number
          totalGroups: number
          totalPairs: number
          items: unknown[]
          pairs: unknown[]
        }
        return c.json({
          groupBy,
          totalPapers: row.totalPapers,
          items: row.items,
          pairs: row.pairs,
          hasMore: row.totalGroups > AGGREGATE_LIMIT,
          pairsHaveMore: row.totalPairs > AGGREGATE_LIMIT,
          limit: AGGREGATE_LIMIT,
        })
      }

      if (groupBy === 'course') {
        const result = await db.execute(sql`
          with visible as (
            select r.id, s.course_id, course.name as course_name
            from research_records r
            join submissions s on s.id = r.submission_id
              and s.status = 'ACCEPTED'
            left join courses course on course.id = s.course_id
            where ${effectiveVisibility(viewer, 'r').rowVisible}
          ), grouped as (
            select course_id::text as id, course_name as label,
              count(*)::integer as count
            from visible
            where course_id is not null and course_name is not null
            group by course_id, course_name
          )
          select
            (select count(*)::integer from visible) as "totalPapers",
            (select count(*)::integer from grouped) as "totalGroups",
            coalesce((select jsonb_agg(to_jsonb(top_groups)) from (
              select id, label, count from grouped
              order by count desc, lower(label), id
              limit ${AGGREGATE_LIMIT}
            ) top_groups), '[]'::jsonb) as items
        `)
        const row = result.rows[0] as {
          totalPapers: number
          totalGroups: number
          items: unknown[]
        }
        return c.json({
          groupBy,
          totalPapers: row.totalPapers,
          items: row.items,
          pairs: [],
          hasMore: row.totalGroups > AGGREGATE_LIMIT,
          pairsHaveMore: false,
          limit: AGGREGATE_LIMIT,
        })
      }

      const result = await db.execute(sql`
        with visible as (
          select r.id, r.year
          from research_records r
          join submissions s on s.id = r.submission_id
            and s.status = 'ACCEPTED'
          where ${effectiveVisibility(viewer, 'r').rowVisible}
        ), grouped as (
          select year::text as id, year::text as label,
            count(*)::integer as count
          from visible group by year
        )
        select
          (select count(*)::integer from visible) as "totalPapers",
          (select count(*)::integer from grouped) as "totalGroups",
          coalesce((select jsonb_agg(to_jsonb(top_groups)) from (
            select id, label, count from grouped
            order by id desc limit ${AGGREGATE_LIMIT}
          ) top_groups), '[]'::jsonb) as items
      `)
      const row = result.rows[0] as {
        totalPapers: number
        totalGroups: number
        items: unknown[]
      }
      return c.json({
        groupBy,
        totalPapers: row.totalPapers,
        items: row.items,
        pairs: [],
        hasMore: row.totalGroups > AGGREGATE_LIMIT,
        pairsHaveMore: false,
        limit: AGGREGATE_LIMIT,
      })
    },
  )

  return app
}
