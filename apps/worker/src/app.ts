import { eq } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { zValidator } from '@hono/zod-validator'
import { courses, profiles, schools, submissions } from '@suluan/db/schema'
import { verifyIdToken, type TokenVerifier } from './auth'
import { isAllowedDomain, parseAllowedOrigins, type Env } from './config'
import { createDb } from './db'
import { createSubmissionAtomic, recordDecisionAtomic } from './writes'
import { UPLOAD_POLICY, buildIntakeKey, extensionMatchesMime } from './uploads'
import {
  createSubmissionSchema,
  decideSchema,
  initiateUploadSchema,
} from './schemas'

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
   * Step 1 of submission: authorize a short-lived direct browser-to-R2
   * upload. No database rows are created here — the submission exists only
   * after finalize verifies the object. Keys are server-generated; client
   * file names become a sanitized suffix only.
   */
  app.post(
    '/api/uploads/initiate',
    requireAuth,
    zValidator('json', initiateUploadSchema),
    async (c) => {
      const { fileName, mimeType, sizeBytes } = c.req.valid('json')
      if (!UPLOAD_POLICY.allowedMimeTypes.includes(mimeType)) {
        return c.json({ error: 'unsupported_file_type' }, 400)
      }
      if (!extensionMatchesMime(fileName, mimeType)) {
        return c.json({ error: 'filename_type_mismatch' }, 400)
      }
      if (sizeBytes > UPLOAD_POLICY.maxSizeBytes) {
        return c.json(
          { error: 'file_too_large', maxSizeBytes: UPLOAD_POLICY.maxSizeBytes },
          400,
        )
      }
      const key = buildIntakeKey(fileName)
      const uploadUrl = await c.env.DOCUMENTS.createPresignedUrl({
        method: 'put',
        key,
        expiration: UPLOAD_POLICY.uploadUrlTtlSeconds,
      })
      return c.json({
        key,
        uploadUrl,
        expiresInSeconds: UPLOAD_POLICY.uploadUrlTtlSeconds,
      })
    },
  )

  /**
   * Step 2 of submission: verify the uploaded object, then persist the
   * PENDING submission, its file row, an audit event, and an outbox event
   * atomically. Retries with the same idempotency key return the original
   * submission instead of duplicating it.
   */
  app.post(
    '/api/submissions',
    requireAuth,
    zValidator('json', createSubmissionSchema),
    async (c) => {
      const body = c.req.valid('json')
      if (!body.key.startsWith(UPLOAD_POLICY.keyPrefix)) {
        return c.json({ error: 'invalid_file_key' }, 400)
      }
      if (
        !UPLOAD_POLICY.allowedMimeTypes.includes(body.mimeType) ||
        !extensionMatchesMime(body.fileName, body.mimeType)
      ) {
        return c.json({ error: 'unsupported_file_type' }, 400)
      }
      if (body.sizeBytes > UPLOAD_POLICY.maxSizeBytes) {
        return c.json(
          { error: 'file_too_large', maxSizeBytes: UPLOAD_POLICY.maxSizeBytes },
          400,
        )
      }
      const stored = await c.env.DOCUMENTS.head(body.key)
      if (!stored) {
        return c.json({ error: 'upload_not_found' }, 422)
      }
      if (stored.size !== body.sizeBytes) {
        return c.json({ error: 'upload_size_mismatch' }, 422)
      }

      const db = createDb(c.env.DATABASE_URL)
      const profile = c.get('profile')

      if (body.schoolId) {
        const school = await db.query.schools.findFirst({
          where: eq(schools.id, body.schoolId),
        })
        if (!school) return c.json({ error: 'unknown_school' }, 400)
      }
      if (body.courseId) {
        const course = await db.query.courses.findFirst({
          where: eq(courses.id, body.courseId),
        })
        if (!course) return c.json({ error: 'unknown_course' }, 400)
        if (body.schoolId && course.schoolId !== body.schoolId) {
          return c.json({ error: 'course_school_mismatch' }, 400)
        }
      }

      const replay = await db.query.submissions.findFirst({
        where: eq(submissions.idempotencyKey, body.idempotencyKey),
      })
      if (replay) {
        if (replay.submitterId !== profile.id) {
          return c.json({ error: 'idempotency_conflict' }, 409)
        }
        return c.json({ id: replay.id, status: replay.status }, 200)
      }

      const created = await (async () => {
        try {
          return await createSubmissionAtomic(db, {
            submitterId: profile.id,
            idempotencyKey: body.idempotencyKey,
            title: body.title,
            authors: body.authors,
            schoolId: body.schoolId,
            courseId: body.courseId,
            year: body.year,
            researchType: body.researchType,
            r2Key: body.key,
            fileName: body.fileName,
            mimeType: body.mimeType,
            sizeBytes: body.sizeBytes,
            submitterEmail: profile.email,
          })
        } catch (err) {
          // Lost a concurrent finalize race: the winner's row is the truth.
          if ((err as { code?: string }).code !== '23505') throw err
          const winner = await db.query.submissions.findFirst({
            where: eq(submissions.idempotencyKey, body.idempotencyKey),
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
    },
  )

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
   * with the discovery stage. Short-lived signed URL, never raw R2 access.
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
      const url = await c.env.DOCUMENTS.createPresignedUrl({
        method: 'get',
        key: file.r2Key,
        expiration: UPLOAD_POLICY.downloadUrlTtlSeconds,
      })
      return c.json({
        url,
        fileName: file.fileName,
        expiresInSeconds: UPLOAD_POLICY.downloadUrlTtlSeconds,
      })
    },
  )

  return app
}
