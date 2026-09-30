import { Link } from 'react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { useAuth } from '@/features/auth/useAuth'
import { SignInButton } from '@/features/auth/SignInButton'

export function SignInPage() {
  const { user } = useAuth()
  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <CardDescription>
          Use your authorized UA Google account. Permissions are assigned by the
          REO, not by signing in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {user ? (
          <p>
            Already signed in as {user.email}.{' '}
            <Link to="/" className="underline underline-offset-4">
              Return home
            </Link>
          </p>
        ) : (
          <SignInButton />
        )}
      </CardContent>
    </Card>
  )
}
