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
