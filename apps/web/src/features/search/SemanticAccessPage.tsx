import { ArrowLeft, LockKeyhole, SearchCheck, ShieldCheck } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { SignInButton } from '@/features/auth/SignInButton'

export function SemanticAccessPage() {
  const [params] = useSearchParams()
  const query = params.get('q')

  return (
    <section className="space-y-10">
      <header className="grid gap-8 border-b border-[var(--border)] pb-9 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <p className="eyebrow text-[var(--impact)]">UA access required</p>
          <h1 className="display-heading mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
            Sign in to use semantic search
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--ink-muted)]">
            Semantic search interprets a research question by meaning, then
            combines that signal with exact-term evidence from accepted papers.
          </p>
        </div>
        <div className="border-l-2 border-[var(--archive-gold)] pl-5 text-sm leading-6 text-[var(--ink-muted)]">
          <ShieldCheck
            className="mb-3 size-5 text-[var(--primary)]"
            aria-hidden="true"
          />
          Public keyword and title search remain available without an account.
          Signing in does not change repository visibility rules.
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.72fr)] lg:gap-16">
        <div>
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center border border-[var(--border)] bg-white text-[var(--primary)]">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="display-heading text-2xl font-semibold">
                Continue with your UA account
              </h2>
              <p className="mt-3 max-w-xl leading-7 text-[var(--ink-muted)]">
                Use your authorized University of the Assumption Google account.
                Daily limits and permissions are enforced by SULUAN before any
                semantic request is made.
              </p>
            </div>
          </div>
          <div className="mt-7 border-y border-[var(--border)] py-6">
            <SignInButton />
          </div>
        </div>

        <aside className="bg-[var(--primary)] p-7 text-white sm:p-8">
          <SearchCheck
            className="size-6 text-[var(--highlight)]"
            aria-hidden="true"
          />
          <h2 className="display-heading mt-5 text-2xl font-semibold">
            Search now without signing in
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/70">
            Keyword search finds exact terms in titles, authors, metadata, and
            prepared full text. No AI query is made.
          </p>
          <Link
            to={query ? `/search?q=${encodeURIComponent(query)}` : '/search'}
            className={`${buttonVariants({ variant: 'secondary' })} mt-6 bg-white text-[var(--primary)] hover:bg-[var(--highlight)] hover:text-[var(--foreground)]`}
          >
            Use keyword search
          </Link>
        </aside>
      </div>

      <Link
        to={query ? `/search?q=${encodeURIComponent(query)}` : '/search'}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to search
      </Link>
    </section>
  )
}
