import { ArrowLeft, Search } from 'lucide-react'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <section className="grid min-h-[28rem] overflow-hidden border border-[var(--border)] bg-white md:grid-cols-[0.72fr_1.28fr]">
      <div className="flex flex-col justify-between bg-[var(--primary)] p-8 text-white sm:p-10">
        <img
          src="/brand/suluan-mark-white.png"
          alt="SULUAN"
          className="size-16 object-contain"
          width="64"
          height="64"
        />
        <p className="display-heading mt-14 text-7xl font-bold text-[var(--highlight)] sm:text-8xl">
          404
        </p>
      </div>
      <div className="flex items-center p-8 sm:p-12">
        <div className="max-w-xl">
          <p className="eyebrow text-[var(--impact)]">Page unavailable</p>
          <h1 className="display-heading mt-3 text-4xl font-semibold sm:text-5xl">
            Page not found
          </h1>
          <p className="mt-5 leading-7 text-[var(--ink-muted)]">
            The address may be incorrect, or the page may have moved. Return to
            the repository or search accepted research.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/" className={buttonVariants()}>
              <ArrowLeft className="size-4" aria-hidden="true" /> Return home
            </Link>
            <Link
              to="/search"
              className={buttonVariants({ variant: 'outline' })}
            >
              <Search className="size-4" aria-hidden="true" /> Search the
              repository
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
