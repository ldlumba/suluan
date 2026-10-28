import { ArrowLeft, Check, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { SignInButton } from '@/features/auth/SignInButton'

export function SignInPage() {
  const { user } = useAuth()

  return (
    <section className="overflow-hidden border border-[var(--border)] bg-white lg:grid lg:min-h-[34rem] lg:grid-cols-[0.9fr_1.1fr]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-[var(--primary)] p-7 text-white sm:p-10 lg:p-12">
        <div
          className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full border-[24px] border-[var(--highlight)]/90"
          aria-hidden="true"
        />
        <div className="relative">
          <img
            src="/brand/suluan-mark-white.png"
            alt="SULUAN"
            className="size-20 object-contain"
            width="80"
            height="80"
          />
          <p className="eyebrow mt-10">University access</p>
          <h1
            aria-label="Sign in"
            className="display-heading mt-4 max-w-md text-4xl font-semibold leading-tight sm:text-5xl"
          >
            Sign in to your research workspace.
          </h1>
          <p className="mt-6 max-w-md leading-7 text-white/75">
            Use your authorized Google account to submit research, track its
            review, and use authenticated discovery tools.
          </p>
        </div>
        <p className="relative mt-12 flex items-start gap-3 border-t border-white/20 pt-5 text-sm leading-6 text-white/70">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Signing in confirms identity only. Repository permissions are assigned
          separately by the Research and Extension Office.
        </p>
      </div>

      <div className="flex items-center p-7 sm:p-10 lg:p-12">
        <div className="w-full max-w-lg">
          <p className="eyebrow text-[var(--impact)]">Secure sign-in</p>
          <h2 className="display-heading mt-3 text-3xl font-semibold sm:text-4xl">
            Continue with Google
          </h2>
          <p className="mt-4 max-w-md leading-7 text-[var(--ink-muted)]">
            University of the Assumption accounts are admitted by default.
          </p>

          <div className="my-8 border-y border-[var(--border)] py-6">
            {user ? (
              <div className="space-y-5">
                <p className="flex items-start gap-3 text-sm leading-6">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-[var(--signal-blue)]"
                    aria-hidden="true"
                  />
                  <span>
                    Already signed in as <strong>{user.email}</strong>.
                  </span>
                </p>
                <Link
                  to="/"
                  className="inline-flex min-h-11 items-center gap-2 font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" /> Return
                  home
                </Link>
              </div>
            ) : (
              <SignInButton />
            )}
          </div>

          <Link
            to="/search"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Browse public
            research without signing in
          </Link>
        </div>
      </div>
    </section>
  )
}
