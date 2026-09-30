import { Navigate } from 'react-router'
import type { ReactNode } from 'react'
import { useAuth } from './useAuth'

/**
 * Presentation-level route guard only. Tolerates expired identity and
 * forbidden access by sending the user back to sign-in; the Worker rechecks
 * authorization on every request regardless of what the router allowed.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading)
    return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
  if (!user) return <Navigate to="/signin" replace />
  return <>{children}</>
}
