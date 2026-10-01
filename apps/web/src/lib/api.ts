const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

export class ApiError extends Error {
  status: number
  /** Machine-readable server code (e.g. 'upload_not_found'), when provided. */
  code: string | null

  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Single choke point for Worker API calls: attaches the Firebase ID token
 * and normalizes auth failures. Callers handle loading/empty/error states;
 * role checks here are display-only — the Worker enforces authorization.
 */
export async function apiFetch<T>(
  path: string,
  token: string | null,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 401)
    throw new ApiError(401, 'Signed out or session expired.')
  if (res.status === 403)
    throw new ApiError(403, 'Your account is not permitted to do that.')
  if (!res.ok) {
    let code: string | null = null
    try {
      const body = (await res.clone().json()) as { error?: unknown }
      if (typeof body.error === 'string') code = body.error
    } catch {
      // Non-JSON error body; fall through to the generic message.
    }
    throw new ApiError(res.status, 'Request failed.', code)
  }
  return (await res.json()) as T
}
