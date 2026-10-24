import { eq, sql } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { courses, profiles, schools, submissions } from '@suluan/db/schema'
import {
  productionServiceVerifier,
  verifyIdToken,
  verifyServiceToken,
  type ServiceTokenVerifier,
  type TokenVerifier,
  type VerifiedServiceIdentity,
} from './auth'
import { isAllowedDomain, parseAllowedOrigins, type Env } from './config'
import { createDb } from './db'
import { createSubmissionAtomic, recordDecisionAtomic } from './writes'
import {
  UPLOAD_POLICY,
  buildDownloadFileName,
  buildIntakeKey,
  validateUploadFile,
} from './uploads'
import { decideSchema, submissionFormFieldsSchema } from './schemas'
import { prepareSubmissionKeywords } from './keywords'
import { normalizeTitle } from './titles'
import { processingRoutes, serviceProcessingRoutes } from './processing'
import { serviceEmbedRoutes } from './embed_claims'
import { searchRoutes } from './search'
import { CHUNKER_VERSION } from './chunking'
import { graphRoutes } from './graph'
import { assistantRoutes } from './assistant-routes'
import {
  repositoryOperationRoutes,
  serviceRepositoryOperationRoutes,
} from './repository-operations'
import {
  cacheControlFor,
  effectiveVisibility,
  effectiveVisibilityLevel,
  viewerRoleFor,
} from './visibility'

type Role = 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN'

interface Variables {
  identity: { uid: string; email: string; emailVerified: boolean }
  profile: typeof profiles.$inferSelect
  serviceIdentity: VerifiedServiceIdentity
}

export type AppContext = { Bindings: Env; Variables: Variables }

/**
 * Build the Hono app with injectable user and workload token verifiers.
 * Tests pass local JWKS verifiers so both protected boundaries are exercised
 * without Google-signed tokens.
 */
export function createApp(
  verifierFor: (projectId: string) => TokenVerifier,
  serviceVerifier: ServiceTokenVerifier = productionServiceVerifier(),
) {
  const app = new Hono<AppContext>()

  /**
   * CORS first: preflight OPTIONS must succeed without credentials so
   * browsers ever reach the auth boundary. Origins are exact-matched
   * against ALLOWED_ORIGINS; anything else gets no ACAO headers.
   */
  app.use('/api/*', async (c, next) => {
    const origins = parseAllowedOrigins(c.env.ALLOWED_ORIGINS)
    return cors({
      origin: origins,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      // The download endpoint streams bytes with a Content-Disposition
      // filename; browsers can only read that header when it is exposed.
      exposeHeaders: ['Content-Disposition'],
      maxAge: 600,
    })(c, next)
  })

  /**
   * Authentication + authorization boundary. Verifies the Firebase ID token,
   * enforces the UA domain allowlist, and loads (or auto-creates as USER)
   * the Neon profile. Client-supplied roles are never trusted — the role
   * comes from Neon only. Every protected route goes through this middleware.
   */
  const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    let identity
    try {
      identity = await verifyIdToken(
        header.slice('Bearer '.length),
        verifierFor(c.env.FIREBASE_PROJECT_ID),
      )
    } catch {
      return c.json({ error: 'unauthorized' }, 401)
    }
    if (!isAllowedDomain(identity.email, c.env.ALLOWED_DOMAINS)) {
      return c.json({ error: 'forbidden' }, 403)
    }

    const db = createDb(c.env.DATABASE_URL)
    const existing = await db.query.profiles.findFirst({
      where: eq(profiles.firebaseUid, identity.uid),
    })
    const profile =
      existing ??
      (
        await db
          .insert(profiles)
          .values({
            firebaseUid: identity.uid,
            email: identity.email,
            role: 'USER',
          })
          .returning()
      )[0]

    c.set('identity', identity)
    c.set('profile', profile)
    await next()
  }

  /**
   * Optional identity for publicly readable routes (owner-approved
   * 2026-10-01). No header, an invalid token, or an expired session all fall
   * through as an anonymous visitor instead of failing the request, so an
   * expired session degrades to public results rather than an error.
   *
   * A *valid* token for a non-UA domain is rejected outright (403): silently
   * downgrading a real identity to anonymous would hide a policy violation.
   */
  const optionalAuth: MiddlewareHandler<AppContext> = async (c, next) => {
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) return next()
    let identity
    try {
      identity = await verifyIdToken(
        header.slice('Bearer '.length),
        verifierFor(c.env.FIREBASE_PROJECT_ID),
      )
    } catch {
      return next()
    }
    if (!isAllowedDomain(identity.email, c.env.ALLOWED_DOMAINS)) {
      return c.json({ error: 'forbidden' }, 403)
    }
    const db = createDb(c.env.DATABASE_URL)
    const existing = await db.query.profiles.findFirst({
      where: eq(profiles.firebaseUid, identity.uid),
    })
    // Read paths must never auto-create profiles (that is a write); a visitor
    // with a valid UA token but no profile row is treated as a plain UA user.
    c.set('identity', identity)
    if (existing) c.set('profile', existing)
    else
      c.set('profile', {
        id: '',
        firebaseUid: identity.uid,
        email: identity.email,
        role: 'USER',
        displayName: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      } satisfies typeof profiles.$inferSelect)
    await next()
  }

  /** Any of the listed roles passes. Ordinary USERs never reach management routes. */
  function requireRole(...roles: Role[]): MiddlewareHandler<AppContext> {
    return async (c, next) => {
      const profile = c.get('profile')
      if (!profile || !roles.includes(profile.role as Role)) {
        return c.json({ error: 'forbidden' }, 403)
      }
      await next()
    }
  }

  /**
   * ADMIN and REPOSITORY_MANAGER remain equivalent for repository operations.
   * Account roles and course availability are the narrow ADMIN-only boundary.
   */
  const MANAGERS: Role[] = ['REPOSITORY_MANAGER', 'ADMIN']

  /** Google workload identity boundary; never grants a user/manager profile. */
  const requireProcessingService: MiddlewareHandler<AppContext> = async (
    c,
    next,
  ) => {
    const audience = c.env.PROCESSING_SERVICE_AUDIENCE?.trim()
    const serviceAccount = c.env.PROCESSING_SERVICE_ACCOUNT?.trim()
    if (!audience || !serviceAccount) {
      return c.json({ error: 'service_auth_not_configured' }, 503)
    }
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    try {
      c.set(
        'serviceIdentity',
        await verifyServiceToken(
          header.slice('Bearer '.length),
          serviceVerifier,
          audience,
          serviceAccount,
        ),
      )
    } catch {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  }

  const requireOperationsService: MiddlewareHandler<AppContext> = async (
    c,
    next,
  ) => {
    const audience = c.env.PROCESSING_SERVICE_AUDIENCE?.trim()
    const serviceAccount = c.env.OPERATIONS_SERVICE_ACCOUNT?.trim()
    if (!audience || !serviceAccount)
      return c.json({ error: 'service_auth_not_configured' }, 503)
    const header = c.req.header('authorization')
    if (!header?.startsWith('Bearer '))
      return c.json({ error: 'unauthorized' }, 401)
    try {
      c.set(
        'serviceIdentity',
        await verifyServiceToken(
          header.slice('Bearer '.length),
          serviceVerifier,
          audience,
          serviceAccount,
        ),
      )
    } catch {
      return c.json({ error: 'unauthorized' }, 401)
    }
    await next()
  }

  app.route(
    '/api/internal/processing',
    serviceProcessingRoutes(requireProcessingService),
  )
  // Region-stable embedding claims for the pinned-region Cloud Run Job.
  // Same workload identity as extraction; never a user/manager profile.
  app.route(
    '/api/internal/embeddings',
    serviceEmbedRoutes(requireProcessingService),
  )
  app.route(
    '/api/internal/repository-operations',
    serviceRepositoryOperationRoutes(requireOperationsService),
  )
  // Dedicated query service identity cannot access document processing routes.
  app.post(
    '/api/internal/query-tickets/redeem',
    bodyLimit({ maxSize: 256 }),
    async (c) => {
      c.header('Cache-Control', 'private, no-store')
      const audience = c.env.QUERY_SERVICE_AUDIENCE
      const account = c.env.QUERY_SERVICE_ACCOUNT
      const header = c.req.header('authorization')
      if (!audience || !account) return c.json({ error: 'unconfigured' }, 503)
      if (!header?.startsWith('Bearer '))
        return c.json({ error: 'unauthorized' }, 401)
      try {
        await verifyServiceToken(
          header.slice(7),
          serviceVerifier,
          audience,
          account,
        )
      } catch {
        return c.json({ error: 'unauthorized' }, 401)
      }
      if (Number(c.req.header('content-length') ?? 0) > 256)
        return c.json({ error: 'oversize' }, 413)
      const parsed = z
        .object({ ticket: z.string().uuid() })
        .strict()
        .safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return c.json({ error: 'invalid_ticket' }, 400)
      const result = await createDb(c.env.DATABASE_URL).execute(sql`
      update embedding_claims set used_at = now()
      where claim_token = ${parsed.data.ticket} and kind = 'query'
        and payload->>'transport' = 'interactive-v1'
        and used_at is null and expires_at > now()
      returning payload->>'sha256' as sha256
    `)
      if (!result.rows.length) return c.json({ error: 'stale_ticket' }, 409)
      return c.json({ sha256: result.rows[0].sha256 })
    },
  )
  app.use('/api/processing/*', requireAuth)
  app.route('/api/assistant', assistantRoutes(requireAuth))
  app.post(
    '/api/internal/assistant-tickets/redeem',
    bodyLimit({ maxSize: 256 }),
    async (c) => {
      c.header('Cache-Control', 'private, no-store')
      const audience = c.env.ASSISTANT_SERVICE_AUDIENCE
      const account = c.env.ASSISTANT_SERVICE_ACCOUNT
      if (!c.env.ASSISTANT_SERVICE_URL || !audience || !account)
        return c.json({ error: 'unconfigured' }, 503)
      const header = c.req.header('authorization')
      if (!header?.startsWith('Bearer '))
        return c.json({ error: 'unauthorized' }, 401)
      try {
        await verifyServiceToken(
          header.slice(7),
          serviceVerifier,
          audience,
          account,
        )
      } catch {
        return c.json({ error: 'unauthorized' }, 401)
      }
      const body = z
        .object({
          ticket: z.string().uuid(),
          stage: z.enum(['embed', 'generate']),
        })
        .strict()
        .safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json({ error: 'invalid_ticket' }, 400)
      const embed = body.data.stage === 'embed'
      const ticket = embed ? sql`embed_ticket` : sql`generate_ticket`
      const used = embed ? sql`embed_used_at` : sql`generate_used_at`
      const hash = embed ? sql`embed_hash` : sql`generate_hash`
      const rows = await createDb(c.env.DATABASE_URL).execute(sql`
      update assistant_requests set ${used} = now()
      where ${ticket} = ${body.data.ticket} and ${used} is null and ${hash} is not null
        and status = 'reserved' and expires_at > now()
      returning ${hash} as sha256
    `)
      if (!rows.rows.length) return c.json({ error: 'stale_ticket' }, 409)
      return c.json({ sha256: rows.rows[0].sha256 })
    },
  )
  app.route('/api/processing', processingRoutes(requireRole(...MANAGERS)))
  app.route(
    '/api/repository-operations',
    repositoryOperationRoutes(requireAuth, requireRole(...MANAGERS)),
  )
  // Search reads are public; preparation stays manager-only.
  app.route(
    '/api/search',
    searchRoutes(optionalAuth, requireAuth, requireRole(...MANAGERS)),
  )
  // Live metadata graph. Every response is viewer-specific and read-only.
  app.route('/api/graph', graphRoutes(optionalAuth))

  /**
   * Public metadata detail for one accepted record. The visibility predicate
   * intentionally matches search and download; an invisible or non-accepted
   * record is always returned as the same 404 to prevent ID probing.
   */
  app.get(
    '/api/records/:id',
    optionalAuth,
    zValidator('param', z.object({ id: z.string().uuid() })),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const profile = c.get('profile')
      const viewer = viewerRoleFor(profile?.role ?? null)
      const authAttempted = Boolean(c.req.header('authorization'))
      const rows = await db.execute(sql`
      select r.id, r.title, r.year::text as year,
        coalesce(authors.names, s.authors) as authors,
        r.doi, r.venue, r.volume, r.issue, r.pages,
        r.pub_year::text as "pubYear",
        coalesce(
          author_list.names,
          (select array_agg(trimmed order by ord)
           from (select trim(line) as trimmed, ord
             from unnest(regexp_split_to_array(s.authors, E'\r?\n'))
               with ordinality as u(line, ord)) t
           where trimmed <> ''),
          '{}'::text[]
        ) as "authorList",
        school.name as "schoolName", course.name as "courseName",
        ${effectiveVisibilityLevel('r')} as visibility,
        case
          when j.status = 'EXTRACTED' and exists (
            select 1 from keyword_indexes i
            where i.record_id = r.id
              and i.extraction_claim_token = j.claim_token
              and i.chunker_version = ${CHUNKER_VERSION}
          ) then 'READY'
          when j.status = 'FAILED' then 'FAILED'
          else 'PENDING'
        end as "fullTextStatus",
        coalesce(kw.terms, '{}'::text[]) as keywords
      from research_records r
      join submissions s on s.id = r.submission_id
      left join processing_jobs j on j.record_id = r.id
      left join schools school on school.id = s.school_id
      left join courses course on course.id = s.course_id
      left join lateral (
        select string_agg(a.name, ', ' order by a.position, a.id) as names
        from record_authors a where a.record_id = r.id
      ) authors on true
      left join lateral (
        select array_agg(a.name order by a.position, a.id) as names
        from record_authors a where a.record_id = r.id
      ) author_list on true
      left join lateral (
        select array_agg(k.display_name order by rk.position, k.id) as terms
        from research_keywords rk join keywords k on k.id = rk.keyword_id
        where rk.record_id = r.id
      ) kw on true
      where r.id = ${c.req.valid('param').id}
        and s.status = 'ACCEPTED'
        and ${effectiveVisibility(viewer, 'r').rowVisible}
      limit 1
    `)
      if (!rows.rows.length) {
        c.header('Cache-Control', 'private, no-store')
        return c.json({ error: 'record_not_found' }, 404)
      }
      c.header('Cache-Control', cacheControlFor(viewer, authAttempted, 30))
      const row = rows.rows[0] as {
        doi: string | null
        venue: string | null
        volume: string | null
        issue: string | null
        pages: string | null
        pubYear: string | null
      } & Record<string, unknown>
      const { doi, venue, volume, issue, pages, pubYear, ...rest } = row
      return c.json({
        ...rest,
        publication: doi
          ? { doi, venue, volume, issue, pages, year: pubYear }
          : null,
      })
    },
  )

  /**
   * Submitter status view (owner-approved 2026-10-01): a signed-in submitter
   * sees ONLY their own submissions, their authoritative status, and the
   * reviewer remarks for decided ones. Other submitters' rows, rejected-file
   * downloads, and manager-only data are never included. This resolves the
   * §4/§10 submitter-status TBD; it does NOT grant document access — the
   * download routes above remain manager-gated for intake files.
   */
  app.get('/api/submissions/mine', requireAuth, async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const me = c.get('profile')
    const rows = await db.execute(sql`
      select s.id, s.title, s.authors, r.year::text as year,
        s.status, s.created_at as "createdAt", s.updated_at as "updatedAt",
        d.remarks, d.decided_at as "decidedAt",
        r.id as "recordId", r.visibility, r.embargo_until as "embargoUntil",
        ${effectiveVisibilityLevel('r')} as "effectiveVisibility",
        coalesce(kw.terms, '{}'::text[]) as keywords
      from submissions s
      left join decisions d on d.submission_id = s.id
      left join research_records r on r.submission_id = s.id
      left join lateral (
        select array_agg(k.term order by k.position, k.id) as terms
        from submission_keywords k where k.submission_id = s.id
      ) kw on true
      where s.submitter_id = ${me.id}
      order by s.created_at desc limit 100
    `)
    return c.json(rows.rows)
  })

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  app.get('/api/me', requireAuth, (c) => {
    const profile = c.get('profile')
    return c.json({
      id: profile.id,
      email: profile.email,
      role: profile.role,
    })
  })

  // Minimal role-boundary probe for Stage 2 acceptance checks. Real admin
  // surfaces arrive with the administration feature.
  app.get('/api/admin/status', requireAuth, requireRole('ADMIN'), (c) =>
    c.json({ status: 'ok', scope: 'admin' }),
  )

  app.get('/api/admin/users', requireAuth, requireRole('ADMIN'), async (c) => {
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
    requireRole('ADMIN'),
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator(
      'json',
      z
        .object({
          role: z.enum(['USER', 'REPOSITORY_MANAGER', 'ADMIN']),
          expectedUpdatedAt: z
            .string()
            .min(1)
            .max(100)
            .refine((value) => Number.isFinite(Date.parse(value)), {
              message: 'Use a valid timestamp.',
            }),
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

  app.get(
    '/api/admin/catalog',
    requireAuth,
    requireRole('ADMIN'),
    async (c) => {
      const rows = await createDb(c.env.DATABASE_URL).execute(sql`
        select s.id as "schoolId", s.name as "schoolName", c.id, c.name,
          c.active, c.updated_at as "updatedAt"
        from schools s join courses c on c.school_id = s.id
        order by s.name, c.name
      `)
      return c.json(rows.rows)
    },
  )

  app.patch(
    '/api/admin/courses/:id',
    requireAuth,
    requireRole('ADMIN'),
    zValidator('param', z.object({ id: z.string().uuid() })),
    zValidator(
      'json',
      z
        .object({
          active: z.boolean(),
          expectedUpdatedAt: z
            .string()
            .min(1)
            .max(100)
            .refine((value) => Number.isFinite(Date.parse(value)), {
              message: 'Use a valid timestamp.',
            }),
        })
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

  // Migration-owned institutional school/course catalog for the submission
  // form. Read-only in the browser; server validation remains authoritative.
  app.get('/api/schools', requireAuth, async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const rows = await db.query.schools.findMany({
      with: { courses: true },
      orderBy: (s, { asc }) => [asc(s.name)],
    })
    return c.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        courses: s.courses
          .filter((course) => course.active)
          .map((course) => ({ id: course.id, name: course.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    )
  })

  /**
   * Submission intake: the browser POSTs multipart/form-data (file + text
   * fields) straight to the Worker, which streams the file into private
   * R2 and then persists the PENDING submission, its file row, an audit
   * event, and an outbox event atomically. The browser never talks to R2
   * directly, so no presigned URLs or bucket CORS are involved.
   *
   * Idempotency: replays with the same idempotency key return the original
   * submission WITHOUT storing another object — the replay check runs
   * before the R2 put. Concurrent first-time races are arbitrated by the
   * unique constraint; the loser deletes its orphaned object best-effort.
   */
  app.post('/api/submissions', requireAuth, async (c) => {
    let form: Record<string, string | File | (string | File)[]>
    try {
      form = (await c.req.parseBody()) as Record<
        string,
        string | File | (string | File)[]
      >
    } catch {
      return c.json({ error: 'invalid_form' }, 400)
    }
    const first = (v: unknown): string | File | undefined =>
      Array.isArray(v) ? (v[0] as string | File) : (v as string | File)

    const rawFile = first(form['file'])
    if (!(rawFile instanceof File)) {
      return c.json({ error: 'missing_file' }, 400)
    }
    const validated = validateUploadFile(rawFile)
    if (typeof validated === 'string') {
      const status = validated === 'file_too_large' ? 400 : 400
      const body =
        validated === 'file_too_large'
          ? { error: validated, maxSizeBytes: UPLOAD_POLICY.maxSizeBytes }
          : { error: validated }
      return c.json(body, status)
    }

    const text = (name: string): string | undefined => {
      const v = first(form[name])
      if (typeof v !== 'string') return undefined
      const trimmed = v.trim()
      return trimmed === '' ? undefined : trimmed
    }
    // Empty strings mean "no selection" for the optional UUID/metadata fields.
    const fields = submissionFormFieldsSchema.safeParse({
      idempotencyKey: text('idempotencyKey'),
      title: text('title'),
      authors: text('authors'),
      schoolId: text('schoolId'),
      courseId: text('courseId'),
      duplicateAcknowledged: text('duplicateAcknowledged'),
    })
    if (!fields.success) {
      return c.json({ error: 'invalid_fields' }, 400)
    }
    const meta = fields.data
    const normalizedTitle = normalizeTitle(meta.title)

    // Author keywords arrive as repeated `keywords[]` parts (one term per
    // part, matching the chip UI). The `[]` suffix matters: Hono's default
    // multipart parsing overwrites repeated bare keys, keeping only the
    // last value. Untrusted like every other field: validated, collapsed,
    // and normalized before storage.
    const preparedKeywords = prepareSubmissionKeywords(form['keywords[]'])
    if ('error' in preparedKeywords) {
      return c.json({ error: 'invalid_keywords' }, 400)
    }

    const db = createDb(c.env.DATABASE_URL)
    const profile = c.get('profile')

    const replay = await db.query.submissions.findFirst({
      where: eq(submissions.idempotencyKey, meta.idempotencyKey),
    })
    if (replay) {
      if (replay.submitterId !== profile.id) {
        return c.json({ error: 'idempotency_conflict' }, 409)
      }
      return c.json({ id: replay.id, status: replay.status }, 200)
    }

    if (meta.schoolId) {
      const school = await db.query.schools.findFirst({
        where: eq(schools.id, meta.schoolId),
      })
      if (!school) return c.json({ error: 'unknown_school' }, 400)
    }
    if (meta.courseId) {
      const course = await db.query.courses.findFirst({
        where: eq(courses.id, meta.courseId),
      })
      if (!course) return c.json({ error: 'unknown_course' }, 400)
      if (!course.active) return c.json({ error: 'course_inactive' }, 409)
      if (meta.schoolId && course.schoolId !== meta.schoolId) {
        return c.json({ error: 'course_school_mismatch' }, 400)
      }
    }

    const duplicates = await db.execute(sql`
      select
        exists(
          select 1 from submissions
          where normalized_title = ${normalizedTitle}
            and submitter_id = ${profile.id}
            and status = 'PENDING'
        ) as "ownPending",
        exists(
          select 1 from submissions
          where normalized_title = ${normalizedTitle}
            and status in ('PENDING', 'ACCEPTED')
        ) as "possibleDuplicate"
    `)
    const duplicateState = duplicates.rows[0] as {
      ownPending: boolean
      possibleDuplicate: boolean
    }
    if (duplicateState.ownPending) {
      return c.json(
        {
          error: 'duplicate_pending',
          message:
            'You already have a submission with this title awaiting review. Check My submissions before sending it again.',
        },
        409,
      )
    }
    if (duplicateState.possibleDuplicate && !meta.duplicateAcknowledged) {
      // Safe disclosure: only already-public repository records are named.
      // Other pending submissions stay hidden to avoid intake leakage.
      const publicMatches = await db.execute(sql`
        select r.id as "recordId", r.title, r.year::text as year
        from submissions s join research_records r on r.submission_id = s.id
        where s.normalized_title = ${normalizedTitle}
          and s.status = 'ACCEPTED'
          and ${effectiveVisibility('PUBLIC', 'r').rowVisible}
        order by r.created_at desc limit 3
      `)
      return c.json(
        {
          error: 'possible_duplicate',
          message:
            'A pending or accepted paper already uses this title. Review the title, or confirm that this is a different paper.',
          publicMatches: publicMatches.rows,
        },
        409,
      )
    }

    const key = buildIntakeKey(validated.fileName)
    try {
      await c.env.DOCUMENTS.put(key, rawFile, {
        httpMetadata: { contentType: validated.mimeType },
      })
    } catch (err) {
      console.error('r2 put failed', err)
      return c.json({ error: 'storage_unavailable' }, 503)
    }

    const created = await (async () => {
      try {
        return await createSubmissionAtomic(db, {
          submitterId: profile.id,
          idempotencyKey: meta.idempotencyKey,
          title: meta.title,
          normalizedTitle,
          authors: meta.authors,
          schoolId: meta.schoolId,
          courseId: meta.courseId,
          r2Key: key,
          fileName: validated.fileName,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          submitterEmail: profile.email,
          keywords: preparedKeywords.keywords,
        })
      } catch (err) {
        // Lost a concurrent finalize race: the winner's row is the truth.
        // Remove the orphaned object best-effort so retries don't leak R2 keys.
        if ((err as { code?: string }).code !== '23505') throw err
        try {
          await c.env.DOCUMENTS.delete(key)
        } catch {
          // Orphan cleanup is best-effort; the DB stays authoritative.
        }
        const winner = await db.query.submissions.findFirst({
          where: eq(submissions.idempotencyKey, meta.idempotencyKey),
        })
        if (winner && winner.submitterId === profile.id) {
          return { submissionId: winner.id, outboxId: null as string | null }
        }
        const duplicate = await db.query.submissions.findFirst({
          where: sql`${submissions.submitterId} = ${profile.id}
            and ${submissions.normalizedTitle} = ${normalizedTitle}
            and ${submissions.status} = 'PENDING'`,
        })
        return duplicate
          ? {
              submissionId: duplicate.id,
              outboxId: null as string | null,
              duplicate: true as const,
            }
          : null
      }
    })()
    if (!created) {
      return c.json({ error: 'idempotency_conflict' }, 409)
    }
    if ('duplicate' in created) {
      return c.json(
        {
          error: 'duplicate_pending',
          message:
            'You already have a submission with this title awaiting review. Check My submissions before sending it again.',
        },
        409,
      )
    }

    // Best-effort enqueue: the outbox row is the durable record, so a
    // failed send only delays the notification until a sweeper exists.
    if (created.outboxId) {
      try {
        await c.env.NOTIFICATIONS.send({ outboxId: created.outboxId })
      } catch (err) {
        console.error('queue send failed', created.outboxId, err)
      }
    }
    const status = created.outboxId ? 201 : 200
    return c.json({ id: created.submissionId, status: 'PENDING' }, status)
  })

  /** REO review queue: PENDING submissions with submitter and file context. */
  app.get(
    '/api/review/queue',
    requireAuth,
    requireRole(...MANAGERS),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const rows = await db.query.submissions.findMany({
        where: eq(submissions.status, 'PENDING'),
        with: {
          submitter: { columns: { email: true } },
          files: {
            columns: { fileName: true, mimeType: true, sizeBytes: true },
          },
          submissionKeywords: {
            columns: { term: true, position: true },
          },
        },
        orderBy: (s, { asc }) => [asc(s.createdAt)],
        limit: 50,
      })
      const duplicateDetails = rows.length
        ? await db.execute(sql`
            select s.normalized_title as "normalizedTitle", s.id, s.title,
              s.status, s.created_at as "createdAt", p.email as "submitterEmail"
            from submissions s left join profiles p on p.id = s.submitter_id
            where s.status in ('PENDING', 'ACCEPTED')
              and s.normalized_title in (${sql.join(
                rows.map((row) => sql`${row.normalizedTitle}`),
                sql`, `,
              )})
            order by s.created_at desc limit 200
          `)
        : { rows: [] }
      const grouped = new Map(
        (
          duplicateDetails.rows as {
            normalizedTitle: string
            id: string
            title: string
            status: string
            createdAt: string
            submitterEmail: string | null
          }[]
        ).reduce(
          (acc, row) => {
            const list = acc.get(row.normalizedTitle) ?? []
            list.push(row)
            acc.set(row.normalizedTitle, list)
            return acc
          },
          new Map<
            string,
            {
              normalizedTitle: string
              id: string
              title: string
              status: string
              createdAt: string
              submitterEmail: string | null
            }[]
          >(),
        ),
      )
      return c.json(
        rows.map((s) => {
          const matches = (grouped.get(s.normalizedTitle) ?? [])
            .filter((m) => m.id !== s.id)
            .slice(0, 5)
            .map((m) => ({
              id: m.id,
              title: m.title,
              status: m.status,
              createdAt: m.createdAt,
              submitterEmail: m.submitterEmail,
            }))
          return {
            id: s.id,
            title: s.title,
            authors: s.authors,
            createdAt: s.createdAt,
            submitterEmail: s.submitter.email,
            files: s.files,
            keywords: s.submissionKeywords
              .sort((a, b) => a.position - b.position)
              .map((k) => k.term),
            possibleDuplicate: matches.length > 0,
            duplicateOf: matches,
          }
        }),
      )
    },
  )

  /**
   * Authoritative accept/reject. Remarks are mandatory (schema-enforced);
   * only PENDING submissions are decidable; accept also creates the linked
   * repository record pointing at the SAME R2 object — never a copy.
   * Everything commits atomically with audit and outbox rows.
   */
  app.post(
    '/api/decisions',
    requireAuth,
    requireRole(...MANAGERS),
    zValidator('json', decideSchema),
    async (c) => {
      const body = c.req.valid('json')
      const db = createDb(c.env.DATABASE_URL)
      const reviewer = c.get('profile')
      // Visibility/embargo apply only to acceptance. On rejection they are
      // ignored so the reviewer flow stays simple; the schema refine already
      // rejects an embargo date combined with PUBLIC visibility.
      const recordVisibility =
        body.status === 'ACCEPTED' ? body.visibility : undefined
      const recordEmbargo =
        body.status === 'ACCEPTED' ? body.embargoUntil : undefined

      const submission = await db.query.submissions.findFirst({
        where: eq(submissions.id, body.submissionId),
        with: {
          files: true,
          submitter: { columns: { email: true } },
        },
      })
      if (!submission) return c.json({ error: 'not_found' }, 404)
      if (submission.status !== 'PENDING') {
        return c.json(
          { error: 'already_decided', status: submission.status },
          409,
        )
      }
      if (submission.files.length === 0) {
        return c.json({ error: 'submission_has_no_file' }, 422)
      }

      let outboxId: string
      try {
        const decided = await recordDecisionAtomic(db, {
          submissionId: submission.id,
          reviewerId: reviewer.id,
          status: body.status,
          remarks: body.remarks,
          title: submission.title,
          authors: submission.authors,
          r2Key: submission.files[0].r2Key,
          fileName: submission.files[0].fileName,
          mimeType: submission.files[0].mimeType,
          submitterEmail: submission.submitter.email,
          visibility: recordVisibility,
          embargoUntil: recordEmbargo,
        })
        if (!decided) {
          // Lost a concurrent decision race; re-read the winner.
          const current = await db.query.submissions.findFirst({
            where: eq(submissions.id, submission.id),
          })
          return c.json(
            { error: 'already_decided', status: current?.status },
            409,
          )
        }
        outboxId = decided.outboxId
      } catch (err) {
        // Concurrent duplicate decision: the unique constraint arbitrates.
        if ((err as { code?: string }).code !== '23505') throw err
        const current = await db.query.submissions.findFirst({
          where: eq(submissions.id, submission.id),
        })
        return c.json(
          { error: 'already_decided', status: current?.status },
          409,
        )
      }

      try {
        await c.env.NOTIFICATIONS.send({ outboxId })
      } catch (err) {
        console.error('queue send failed', outboxId, err)
      }
      return c.json(
        {
          id: submission.id,
          status: body.status,
          visibility: recordVisibility ?? null,
          embargoUntil: recordEmbargo ?? null,
        },
        201,
      )
    },
  )

  /**
   * Reviewer access to any submission, PENDING or decided. Kept separate from
   * the public record download: REO must read papers before deciding.
   */
  app.get(
    '/api/submissions/:id/download',
    requireAuth,
    requireRole(...MANAGERS),
    async (c) => {
      const db = createDb(c.env.DATABASE_URL)
      const submission = await db.query.submissions.findFirst({
        where: eq(submissions.id, c.req.param('id')),
        with: { files: true },
      })
      if (!submission || submission.files.length === 0) {
        return c.json({ error: 'not_found' }, 404)
      }
      const file = submission.files[0]
      return streamR2Object(
        c.env,
        {
          r2Key: file.r2Key,
          fileName: file.fileName,
          mimeType: file.mimeType,
          downloadName: buildDownloadFileName(submission.title, file.fileName),
        },
        // Reviewer access is always private: never let caches store it.
        'private, no-store',
      )
    },
  )

  /**
   * Public accepted-paper download (owner-approved 2026-10-01). Visibility is
   * enforced from Neon on every request: PUBLIC is open to anonymous
   * visitors, UA_ONLY requires a signed-in UA account, RESTRICTED is
   * manager-only. The Worker streams the private R2 bytes — the browser never
   * touches R2, so no signed URLs or bucket CORS are involved.
   *
   * Rejected submissions have no record row, so they cannot be resolved here.
   */
  app.get('/api/records/:id/download', optionalAuth, async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const profile = c.get('profile')
    const viewer = viewerRoleFor(profile?.role ?? null)
    const found = await db.execute(sql`
      select f.r2_key as "r2Key", f.file_name as "fileName",
        f.mime_type as "mimeType", r.title
      from research_records r
      join submissions s on s.id = r.submission_id
      join record_files f on f.record_id = r.id
      where r.id = ${c.req.param('id')} and s.status = 'ACCEPTED'
        and ${effectiveVisibility(viewer, 'r').rowVisible}
      limit 1
    `)
    if (found.rows.length === 0) {
      // One 404 shape for every viewer so restricted records are not
      // discoverable by probing IDs (no 403 that confirms existence).
      return c.json({ error: 'not_found' }, 404)
    }
    const row = found.rows[0] as {
      r2Key: string
      fileName: string
      mimeType: string | null
      title: string
    }
    return streamR2Object(
      c.env,
      {
        r2Key: row.r2Key,
        fileName: row.fileName,
        mimeType: row.mimeType,
        downloadName: buildDownloadFileName(row.title, row.fileName),
      },
      // Anonymous caching is safe for PUBLIC papers (identical for everyone);
      // signed-in requests — and requests bearing an unverifiable credential —
      // are role-dependent and must not be stored.
      cacheControlFor(
        viewer,
        c.req.header('authorization')?.startsWith('Bearer ') ?? false,
        300,
      ),
    )
  })

  return app
}

/**
 * Stream one R2 object back as an attachment, named after the study title.
 * The quoted filename stays ASCII-safe; the `filename*` parameter carries the
 * full UTF-8 name so browsers can read it cross-origin.
 */
async function streamR2Object(
  env: Env,
  file: {
    r2Key: string
    fileName: string
    mimeType: string | null
    downloadName: string
  },
  cacheControl: string,
): Promise<Response> {
  const obj = await env.DOCUMENTS.get(file.r2Key)
  if (!obj) {
    return new Response(JSON.stringify({ error: 'file_missing' }), {
      status: 410,
      headers: { 'content-type': 'application/json' },
    })
  }
  const asciiName = file.downloadName.replace(/[^\x20-\x7E]/g, '_')
  const headers = new Headers()
  headers.set(
    'content-type',
    file.mimeType ?? obj.contentType ?? 'application/octet-stream',
  )
  headers.set(
    'content-disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.downloadName)}`,
  )
  headers.set('content-length', String(obj.size))
  headers.set('cache-control', cacheControl)
  return new Response(obj.body, { headers })
}
