import { Navigate, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import type { ServerProfile } from './AuthContext'
import { useAuth } from './useAuth'

/**
 * Presentation-level route guard only. Signed-out visitors are sent to
 * sign-in; insufficient roles see a generic 404. The Worker rechecks
 * authorization on every request regardless of what the router allowed.
 */
export function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode
  roles?: ServerProfile['role'][]
}) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  if (loading)
    return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
  if (!user) {
    const returnTo = `${location.pathname}${location.search}`
    return (
      <Navigate
        to={`/signin?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    )
  }
  if (roles && (!profile || !roles.includes(profile.role)))
    return <NotFoundPage />
  return <>{children}</>
}
