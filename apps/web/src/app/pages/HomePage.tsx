import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Search } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'

interface RecentPaper {
  id: string
  title: string
  authors: string | null
  schoolName: string | null
  courseName: string | null
}

interface RecentPapersResponse {
  items: RecentPaper[]
}

const RECENT_PAPER_COUNT = 6

export function HomePage() {
  const { profile, loading, getIdToken } = useAuth()
  const recentPapers = useQuery({
    queryKey: ['home-recent-papers', profile?.id, profile?.role],
    enabled: !loading,
    retry: false,
    queryFn: async () => {
      const result = await apiFetch<RecentPapersResponse>(
        '/api/search/records?q=&page=1&sort=newest',
        await getIdToken(),
      )
      return result.items.slice(0, RECENT_PAPER_COUNT)
    },
  })

  return (
    <div className="relative left-1/2 -mt-8 -mb-8 w-screen -translate-x-1/2 lg:-mt-12 lg:-mb-12">
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
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <h2 className="display-heading max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
          Three ways to find research.
        </h2>
        <p className="mt-5 max-w-2xl leading-7 text-[var(--ink-muted)]">
          Start with a question, a keyword, or a word you remember from a title.
          Choose the search method that fits what you know.
        </p>
        <div className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
          {[
            {
              name: 'Keyword search',
              description:
                'Find specific terms in paper titles, authors, course details, and searchable full text. A good place to start when you know the words you need.',
              example: 'Try “solar panel” or an author’s name.',
              access: 'Available to everyone',
              to: '/search',
            },
            {
              name: 'Semantic search',
              description:
                'Describe what you are looking for in your own words. Meaning and exact-term evidence work together to find related research without admitting unrelated results.',
              example: 'Try “Study that helps farmers”.',
              access: 'UA sign-in required',
              to: '/search?mode=semantic',
            },
            {
              name: 'Title search',
              description:
                'Look for exact words in paper titles only. Matches ignore case, but keep word forms distinct: “farmer” does not match “farmers”.',
              example: 'Try “farmers” to find it in a title.',
              access: 'Available to everyone',
              to: '/search?mode=title',
            },
          ].map((method) => (
            <div
              key={method.to}
              className="flex flex-col border-t-2 border-[var(--primary)] pt-5"
            >
              <h3 className="text-xl font-bold">{method.name}</h3>
              <p className="mt-3 leading-7 text-[var(--ink-muted)]">
                {method.description}
              </p>
              <p className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">
                {method.example}
              </p>
              <div className="mt-auto pt-6">
                <p className="mb-3 text-sm text-[var(--ink-muted)]">
                  {method.access}
                </p>
                <Link
                  to={method.to}
                  className="inline-flex min-h-11 items-center gap-2 font-semibold text-[var(--primary)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--signal-blue)]"
                >
                  {method.name}
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[var(--primary)] px-4 py-16 text-white sm:px-6 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-6 border-b border-white/20 pb-8 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow text-[var(--highlight)]">Recently added</p>
              <h2 className="display-heading mt-3 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
                Newly accepted research.
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-white/70">
                The latest papers added to the SULUAN repository, following REO
                review and acceptance.
              </p>
            </div>
            <Link
              to="/search?sort=newest"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start font-semibold text-[var(--highlight)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--highlight)] sm:self-auto"
            >
              Browse newest papers
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>

          {(loading || recentPapers.isLoading) && (
            <p role="status" className="py-10 text-white/70">
              Loading newly accepted papers…
            </p>
          )}
          {recentPapers.isError && (
            <p role="status" className="py-10 text-white/70">
              Newly accepted papers are temporarily unavailable.
            </p>
          )}
          {recentPapers.data?.length === 0 && (
            <p className="py-10 text-white/70">
              No accepted papers are available yet.
            </p>
          )}
          {recentPapers.data && recentPapers.data.length > 0 && (
            <ol className="grid gap-x-10 md:grid-cols-2 lg:grid-cols-3">
              {recentPapers.data.map((paper, index) => {
                const affiliation = [paper.schoolName, paper.courseName]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <li
                    key={paper.id}
                    className="group border-b border-white/20 py-7 lg:min-h-56"
                  >
                    <p className="font-mono text-xs text-white/45">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <h3 className="display-heading mt-4 text-2xl font-semibold leading-tight">
                      <Link
                        to={`/records/${encodeURIComponent(paper.id)}`}
                        className="transition-colors group-hover:text-[var(--highlight)] hover:underline focus-visible:rounded-[2px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--highlight)]"
                      >
                        {paper.title}
                      </Link>
                    </h3>
                    <p className="mt-5 text-sm leading-6 text-white/75">
                      {paper.authors || 'Authors not listed'}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-white/55">
                      {affiliation || 'School and course not listed'}
                    </p>
                  </li>
                )
              })}
            </ol>
          )}
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
