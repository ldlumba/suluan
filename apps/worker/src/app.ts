import { eq } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { profiles } from '@suluan/db/schema'
import { verifyIdToken, type TokenVerifier } from './auth'
import { isAllowedDomain, type Env } from './config'
import { createDb } from './db'

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

  function requireRole(role: Role): MiddlewareHandler<AppContext> {
    return async (c, next) => {
      const profile = c.get('profile')
      if (!profile || profile.role !== role) {
        return c.json({ error: 'forbidden' }, 403)
      }
      await next()
    }
  }

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

  return app
}
