import { ArrowUpRight, BookOpen, Search, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'

export function HomePage() {
  return (
    <div className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 lg:-mt-12">
      <section className="relative overflow-hidden bg-[var(--primary)] px-4 py-20 text-white sm:px-6 sm:py-28 lg:px-8">
        <div
          className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full border-[28px] border-[var(--highlight)]/90 sm:size-96"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute bottom-0 left-[8%] h-2 w-28 bg-[var(--impact)] sm:w-44"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-7xl">
          <div className="max-w-4xl">
            <p className="eyebrow mb-6">
              University of the Assumption · Research repository
            </p>
            <h1 className="display-heading max-w-4xl text-5xl font-bold leading-[0.98] sm:text-7xl lg:text-[5.5rem]">
              Find the work that moves UA forward.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-white/75 sm:text-xl">
              Explore accepted research from the University of the Assumption —
              by title, author, course, or the ideas inside each paper.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/search"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[6px] bg-[var(--accent)] px-6 text-sm font-semibold text-white transition-colors hover:bg-[var(--highlight)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--highlight)]"
              >
                <Search className="size-5" aria-hidden="true" />
                Explore the repository
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                to="/submit"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[6px] border border-white/30 bg-transparent px-6 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-[var(--primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--highlight)]"
              >
                Submit your research
              </Link>
            </div>
          </div>
          <div className="mt-16 grid max-w-3xl grid-cols-1 gap-4 border-t border-white/20 pt-6 text-sm sm:grid-cols-3">
            <p className="text-white/70">
              <strong className="block text-white">Search</strong>Find accepted
              UA papers.
            </p>
            <p className="text-white/70">
              <strong className="block text-white">Understand</strong>See
              authors, courses, and context.
            </p>
            <p className="text-white/70">
              <strong className="block text-white">Access</strong>Read what the
              record allows.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.25fr] lg:items-start">
          <div>
            <p className="eyebrow text-[var(--impact)]">
              A governed collection
            </p>
            <h2 className="display-heading mt-4 max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">
              Research, with the context to trust it.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border-t-2 border-[var(--primary)] pt-5">
              <ShieldCheck
                className="size-6 text-[var(--primary)]"
                aria-hidden="true"
              />
              <h3 className="mt-5 text-xl font-bold">Reviewed by UA</h3>
              <p className="mt-3 leading-7 text-[var(--ink-muted)]">
                Papers enter the public repository only after the Research and
                Extension Office makes a decision.
              </p>
            </div>
            <div className="border-t-2 border-[var(--highlight)] pt-5">
              <BookOpen
                className="size-6 text-[var(--primary)]"
                aria-hidden="true"
              />
              <h3 className="mt-5 text-xl font-bold">Made to be found</h3>
              <p className="mt-3 leading-7 text-[var(--ink-muted)]">
                Search by the language of your question, or browse the work
                connected to a course and school.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[var(--secondary)] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow text-[var(--primary)]">
              Start with a question
            </p>
            <h2 className="display-heading mt-3 max-w-2xl text-3xl font-semibold sm:text-4xl">
              The collection is ready when you are.
            </h2>
          </div>
          <Link
            to="/search"
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[6px] bg-[var(--primary)] px-6 text-sm font-semibold text-white transition-colors hover:bg-[var(--highlight)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Search SULUAN <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  )
}
