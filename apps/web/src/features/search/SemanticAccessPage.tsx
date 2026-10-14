import { ArrowLeft, LockKeyhole, SearchCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { SignInButton } from '@/features/auth/SignInButton'

export function SemanticAccessPage() {
  const [params] = useSearchParams()
  const query = params.get('q')

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="border-t-2 border-t-[var(--archive-gold)]">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-[6px] bg-[var(--secondary)] text-[var(--primary)]">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow text-[var(--impact)]">UA access required</p>
              <h1 className="display-heading mt-2 text-3xl font-semibold sm:text-4xl">
                Sign in to use semantic search
              </h1>
              <CardDescription className="mt-3 leading-7">
                Semantic Search combines meaning with exact-term evidence from
                accepted papers. It is available to authenticated University of
                the Assumption users; public keyword search remains available to
                everyone.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="border-t border-[var(--border)] pt-5">
            <div className="flex items-start gap-3">
              <SearchCheck
                className="mt-0.5 size-5 shrink-0 text-[var(--signal-blue)]"
                aria-hidden="true"
              />
              <p className="text-sm leading-6 text-[var(--ink-muted)]">
                Sign in with your authorized{' '}
                <strong className="text-[var(--foreground)]">@ua.edu.ph</strong>{' '}
                Google account to continue. Signing in identifies you; access
                permissions are still enforced by SULUAN.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SignInButton />
            <Link
              to={query ? `/search?q=${encodeURIComponent(query)}` : '/search'}
              className={buttonVariants({ variant: 'outline' })}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Use keyword search
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
