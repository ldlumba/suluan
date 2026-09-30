const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
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
  if (!res.ok) throw new ApiError(res.status, 'Request failed.')
  return (await res.json()) as T
}
