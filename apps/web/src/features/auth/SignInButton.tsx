import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isFirebaseConfigured } from '@/lib/firebase'
import { useAuth } from './useAuth'

export function SignInButton() {
  const { signIn, error } = useAuth()
  return (
    <div className="space-y-2">
      <Button
        onClick={() => void signIn()}
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
