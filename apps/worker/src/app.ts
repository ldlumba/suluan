import { eq } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'
import { courses, profiles, schools, submissions } from '@suluan/db/schema'
import { verifyIdToken, type TokenVerifier } from './auth'
import { isAllowedDomain, parseAllowedOrigins, type Env } from './config'
import { createDb } from './db'
import { createSubmissionAtomic, recordDecisionAtomic } from './writes'
import { UPLOAD_POLICY, buildIntakeKey, validateUploadFile } from './uploads'
import { decideSchema, submissionFormFieldsSchema } from './schemas'

type Role = 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN'

interface Variables {
  identity: { uid: string; email: string; emailVerified: boolean }
  profile: typeof profiles.$inferSelect
}

export type AppContext = { Bindings: Env; Variables: Variables }

/**
 * Build the Hono app with an injectable token verifier. Production passes
 * the Google JWKS verifier; tests pass a local-JWKS verifier so protected
 * routes are exercised without Google-signed tokens.
 */
export function createApp(verifierFor: (projectId: string) => TokenVerifier) {
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

  const MANAGERS: Role[] = ['REPOSITORY_MANAGER', 'ADMIN']

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

  // School/course catalog for the submission form. Read-only; catalog
  // contents remain TBD and these tables ship empty until seeded.
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
        courses: s.courses.map((course) => ({
          id: course.id,
          name: course.name,
        })),
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
      year: text('year'),
      researchType: text('researchType'),
    })
    if (!fields.success) {
      return c.json({ error: 'invalid_fields' }, 400)
    }
    const meta = fields.data

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
      if (meta.schoolId && course.schoolId !== meta.schoolId) {
        return c.json({ error: 'course_school_mismatch' }, 400)
      }
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
          authors: meta.authors,
          schoolId: meta.schoolId,
          courseId: meta.courseId,
          year: meta.year,
          researchType: meta.researchType,
          r2Key: key,
          fileName: validated.fileName,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          submitterEmail: profile.email,
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
        return null
      }
    })()
    if (!created) {
      return c.json({ error: 'idempotency_conflict' }, 409)
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
        },
        orderBy: (s, { asc }) => [asc(s.createdAt)],
        limit: 50,
      })
      return c.json(
        rows.map((s) => ({
          id: s.id,
          title: s.title,
          authors: s.authors,
          year: s.year,
          researchType: s.researchType,
          createdAt: s.createdAt,
          submitterEmail: s.submitter.email,
          files: s.files,
        })),
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
          r2Key: submission.files[0].r2Key,
          fileName: submission.files[0].fileName,
          mimeType: submission.files[0].mimeType,
          submitterEmail: submission.submitter.email,
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
      return c.json({ id: submission.id, status: body.status }, 201)
    },
  )

  /**
   * Authorized file access. Managers only: submitters have no implied
   * document access (explicit policy required), and public downloads arrive
   * with the discovery stage. The Worker streams the private R2 bytes back
   * after authorization — the browser never touches R2, so no signed URLs
   * or bucket CORS are involved.
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
      const obj = await c.env.DOCUMENTS.get(file.r2Key)
      if (!obj) {
        return c.json({ error: 'file_missing' }, 410)
      }
      const safeName = file.fileName.replace(/["\\\r\n]/g, '_')
      const headers = new Headers()
      headers.set(
        'content-type',
        file.mimeType ?? obj.contentType ?? 'application/octet-stream',
      )
      headers.set(
        'content-disposition',
        `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      )
      headers.set('content-length', String(obj.size))
      // Authorized content: never let caches store it.
      headers.set('cache-control', 'private, no-store')
      return new Response(obj.body, { headers })
    },
  )

  return app
}
