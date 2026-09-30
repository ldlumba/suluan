import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { ApiError, apiFetch } from '@/lib/api'
import { auth, googleProvider } from '@/lib/firebase'
import { AuthContext, type ServerProfile } from './AuthContext'

/**
 * Small session-presentation provider (handoff §5). Owns identity display
 * state and the ID token used for API calls. Business records, roles, and
 * workflow decisions stay server-side; `profile` is a display copy that is
 * refetched on every sign-in and cleared on sign-out.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ServerProfile | null>(null)
  // No Firebase config (e.g. CI) means no session will ever arrive.
  const [loading, setLoading] = useState(() => auth !== null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, (next) => {
      void (async () => {
        setUser(next)
        setProfile(null)
        setError(null)
        if (next) {
          try {
            const token = await next.getIdToken()
            setProfile(await apiFetch<ServerProfile>('/api/me', token))
          } catch (err) {
            // Signed in but profile unknown (expired session, forbidden
            // domain, network). UI must tolerate this, not assume USER.
            setProfile(null)
            if (err instanceof ApiError) setError(err.message)
          }
        }
        setLoading(false)
      })()
    })
  }, [])

  const signIn = useCallback(async () => {
    if (!auth || !googleProvider) {
      setError('Sign-in is not configured in this build.')
      return
    }
    setError(null)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch {
      setError('Google sign-in failed. Check popups and try again.')
    }
  }, [])

  const signOut = useCallback(async () => {
    if (auth) await firebaseSignOut(auth)
    setUser(null)
    setProfile(null)
    setError(null)
    // Protected server caches (TanStack Query) do not exist yet; when the
    // query client lands, it must be cleared here (handoff §5).
  }, [])

  const value = useMemo(
    () => ({ user, profile, loading, error, signIn, signOut }),
    [user, profile, loading, error, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
