import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, ArrowUpRight, Search } from 'lucide-react'
import { Link } from 'react-router'
import { useRef } from 'react'
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
interface ProgramPaper extends RecentPaper {
  courseId: string
  courseName: string
  year: string | null
}

const RECENT_PAPER_COUNT = 6

export function HomePage() {
  const { profile, loading, getIdToken } = useAuth()
  const programPapers = useQuery({
    queryKey: ['home-program-highlights', profile?.id, profile?.role],
    enabled: !loading,
    retry: false,
    queryFn: async () =>
      apiFetch<{ items: ProgramPaper[] }>(
        '/api/search/program-highlights',
        await getIdToken(),
      ),
  })
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
    <div className="w-full min-w-0">
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
              by title, author, program, or the ideas inside each paper.
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
                'Find specific terms in paper titles, authors, program details, and searchable full text. A good place to start when you know the words you need.',
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
              className="group flex flex-col border-t-2 border-[var(--primary)] pt-5 transition-colors duration-200 hover:border-[var(--accent)] focus-within:border-[var(--accent)]"
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
                  <ArrowUpRight
                    className="size-4 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                    aria-hidden="true"
                  />
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
                    className="group border-b border-white/20 py-7 transition-colors duration-200 hover:border-[var(--highlight)] focus-within:border-[var(--highlight)] lg:min-h-56"
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
                      {affiliation || 'School and program not listed'}
                    </p>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </section>

      <ProgramCarousel
        papers={programPapers.data?.items}
        loading={loading || programPapers.isLoading}
        error={programPapers.isError}
      />

      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
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
            onClick={(event) => {
              if (
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey &&
                event.button === 0
              )
                window.scrollTo({ top: 0, behavior: 'instant' })
            }}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[6px] bg-[var(--primary)] px-6 text-sm font-semibold text-white transition-colors hover:bg-[var(--highlight)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Search SULUAN <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  )
}

function ProgramCarousel({
  papers,
  loading,
  error,
}: {
  papers: ProgramPaper[] | undefined
  loading: boolean
  error: boolean
}) {
  const rail = useRef<HTMLUListElement>(null)
  function move(direction: -1 | 1) {
    const element = rail.current
    if (!element) return
    const cardWidth =
      element.firstElementChild?.getBoundingClientRect().width ?? 0
    const gap =
      Number.parseFloat(window.getComputedStyle(element).columnGap) || 20
    element.scrollBy({
      left: direction * (cardWidth ? cardWidth + gap : 320),
      behavior: 'auto',
    })
  }
  return (
    <section
      className="bg-[var(--secondary)] px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
      aria-labelledby="browse-program-heading"
      aria-roledescription="carousel"
    >
      <div className="mx-auto max-w-7xl">
        <p className="eyebrow text-[var(--impact)]">Explore the collection</p>
        <h2
          id="browse-program-heading"
          className="display-heading mt-3 text-4xl font-semibold leading-tight sm:text-5xl"
        >
          Browse by program.
        </h2>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--ink-muted)]">
          Discover a recently accepted paper from each program. Use the arrows
          or swipe to explore.
        </p>
        {loading && (
          <p role="status" className="py-10 text-[var(--ink-muted)]">
            Loading program papers…
          </p>
        )}
        {error && (
          <p role="status" className="py-10 text-[var(--ink-muted)]">
            Program papers are temporarily unavailable.
          </p>
        )}
        {papers?.length === 0 && (
          <p className="py-10 text-[var(--ink-muted)]">
            No program papers are available yet.
          </p>
        )}
        {papers && papers.length > 0 && (
          <>
            <ul
              id="program-paper-rail"
              ref={rail}
              aria-label="Recently accepted papers by program"
              tabIndex={0}
              className="mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-safe:scroll-smooth motion-reduce:scroll-auto"
            >
              {papers.map((paper, index) => (
                <li
                  key={paper.courseId}
                  className="group flex min-h-72 w-[min(85vw,22rem)] shrink-0 snap-start flex-col border-t-2 border-[var(--primary)] bg-white p-6 transition-[border-color,box-shadow] duration-200 hover:border-[var(--accent)] hover:shadow-md focus-within:border-[var(--accent)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="eyebrow text-[var(--impact)]">
                      {paper.courseName}
                    </p>
                    <span className="font-mono text-xs text-[var(--ink-muted)]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="display-heading mt-5 text-2xl font-semibold leading-tight">
                    <Link
                      className="transition-colors hover:text-[var(--primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                      to={`/records/${encodeURIComponent(paper.id)}`}
                    >
                      {paper.title}
                    </Link>
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">
                    {paper.authors || 'Authors not listed'}
                  </p>
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">
                    {[paper.schoolName, paper.year].filter(Boolean).join(' · ')}
                  </p>
                  <Link
                    className="mt-auto inline-flex min-h-11 items-center gap-2 pt-5 text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
                    to={`/search?sort=newest&courseId=${encodeURIComponent(paper.courseId)}`}
                  >
                    More from this program{' '}
                    <ArrowUpRight
                      className="size-4 motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-5">
              <Link
                to="/search"
                className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                Explore all papers{' '}
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
              {papers.length > 1 && (
                <div
                  className="flex items-center gap-2"
                  aria-label="Browse program papers controls"
                >
                  <button
                    type="button"
                    aria-label="Previous program papers"
                    aria-controls="program-paper-rail"
                    onClick={() => move(-1)}
                    className="grid size-11 place-items-center rounded-full border border-[var(--primary)] text-[var(--primary)] transition-colors hover:bg-[var(--primary)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <ArrowLeft className="size-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next program papers"
                    aria-controls="program-paper-rail"
                    onClick={() => move(1)}
                    className="grid size-11 place-items-center rounded-full bg-[var(--primary)] text-white transition-colors hover:bg-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <ArrowRight className="size-5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
