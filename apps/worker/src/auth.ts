import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export interface VerifiedIdentity {
  /** Firebase UID (the `sub` claim) — the only stable user key. */
  uid: string
  email: string
  emailVerified: boolean
}

export interface TokenVerifier {
  jwks: JWTVerifyGetKey
  projectId: string
}

export interface ServiceTokenVerifier {
  jwks: JWTVerifyGetKey
}

export interface VerifiedServiceIdentity {
  subject: string
  email: string
}

/** Production verifier: Google's public JWKS. No service-account secret needed. */
export function productionVerifier(projectId: string): TokenVerifier {
  return {
    jwks: createRemoteJWKSet(
      new URL(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      ),
    ),
    projectId,
  }
}

/** Google workload identity keys used by Cloud Run metadata-server tokens. */
export function productionServiceVerifier(): ServiceTokenVerifier {
  return {
    jwks: createRemoteJWKSet(
      new URL('https://www.googleapis.com/oauth2/v3/certs'),
    ),
  }
}

/**
 * Verify a Firebase ID token: signature, issuer, audience, expiry.
 * Throws on any failure — callers translate to 401 without leaking why.
 * Email is required: Google Sign-In always supplies it, and the domain
 * allowlist plus profile records depend on it.
 */
export async function verifyIdToken(
  token: string,
  verifier: TokenVerifier,
): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(token, verifier.jwks, {
    issuer: `https://securetoken.google.com/${verifier.projectId}`,
    audience: verifier.projectId,
  })
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('missing sub claim')
  }
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new Error('missing email claim')
  }
  return {
    uid: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
  }
}

/** Verify and pin a short-lived Google workload token to one extraction job. */
export async function verifyServiceToken(
  token: string,
  verifier: ServiceTokenVerifier,
  audience: string,
  serviceAccount: string,
): Promise<VerifiedServiceIdentity> {
  const { payload } = await jwtVerify(token, verifier.jwks, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience,
  })
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error('missing sub claim')
  }
  if (
    typeof payload.email !== 'string' ||
    payload.email.toLowerCase() !== serviceAccount.trim().toLowerCase() ||
    payload.email_verified !== true
  ) {
    throw new Error('service account mismatch')
  }
  return { subject: payload.sub, email: payload.email }
}
