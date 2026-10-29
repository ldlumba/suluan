import { LogIn } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { isFirebaseConfigured } from '@/lib/firebase'
import { useAuth } from './useAuth'

export function SignInButton({ returnTo }: { returnTo?: string } = {}) {
  const { signIn, error } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedDestination = returnTo ?? params.get('returnTo') ?? '/'
  // Keep return navigation inside the application; never turn a query string
  // into an open redirect.
  const destination =
    requestedDestination.startsWith('/') &&
    !requestedDestination.startsWith('//')
      ? requestedDestination
      : '/'

  async function handleSignIn() {
    const succeeded = await signIn()
    if (!succeeded) return
    navigate(destination, { state: { signedIn: true } })
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={() => void handleSignIn()}
        disabled={!isFirebaseConfigured}
        title={
          isFirebaseConfigured
            ? 'Sign in with your UA Google account'
            : 'Sign-in is not configured in this build'
        }
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Sign in with Google
      </Button>
      {!isFirebaseConfigured && (
        <p className="text-sm text-muted-foreground">
          Sign-in is unavailable: Firebase client configuration is missing.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
