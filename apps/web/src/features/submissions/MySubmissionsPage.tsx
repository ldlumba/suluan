import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import {
  ClipboardList,
  Clock3,
  CircleCheck,
  CircleX,
  Search,
} from 'lucide-react'
import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

interface MySubmission {
  id: string
  title: string
  authors: string | null
  year: string | null
  keywords: string[]
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  createdAt: string
  updatedAt: string
  remarks: string | null
  decidedAt: string | null
  recordId: string | null
  visibility: string | null
  embargoUntil: string | null
  effectiveVisibility: string | null
}

const STATUS_LABEL: Record<MySubmission['status'], string> = {
  PENDING: 'Awaiting REO review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Returned',
}

const STATUS_STYLE: Record<MySubmission['status'], string> = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-900',
  ACCEPTED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  REJECTED: 'border-red-300 bg-red-50 text-red-800',
}

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING', label: 'Awaiting review' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Returned' },
] as const
const PAGE_SIZE = 10

/**
 * Submitter status view (owner-approved 2026-10-01). Shows only the signed-in
 * submitter's own submissions, their authoritative status, and reviewer
 * remarks. It grants NO document access — downloads remain manager-gated.
 */
export function MySubmissionsPage() {
  const { user, profile, loading, getIdToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const status = params.get('status') ?? 'ALL'
  const requestedPage = Number(params.get('page') ?? '1')
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const mine = useQuery({
    queryKey: ['my-submissions', profile?.id],
    enabled: user !== null,
    retry: false,
    queryFn: async () =>
      apiFetch<MySubmission[]>('/api/submissions/mine', await getIdToken()),
  })

  const filtered = useMemo(() => {
    const items = mine.data ?? []
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return items.filter((item) => {
      const matchesStatus = status === 'ALL' || item.status === status
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLocaleLowerCase().includes(normalizedSearch) ||
        (item.authors ?? '').toLocaleLowerCase().includes(normalizedSearch)
      return matchesStatus && matchesSearch
    })
  }, [mine.data, search, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visibleItems = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  function updateFilter(name: string, value: string) {
    const next = new URLSearchParams(params)
    next.set('page', '1')
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next)
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(params)
    next.set('page', String(nextPage))
    setParams(next)
  }

  if (loading)
    return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
  if (!user) {
    return (
      <div className="border-t-2 border-[var(--primary)] bg-white p-6 text-sm">
        <p className="font-semibold">Sign in to track your research.</p>
        <p className="mt-2 leading-6 text-[var(--ink-muted)]">
          <Link to="/signin" className="underline underline-offset-4">
            Sign in
          </Link>{' '}
          with your UA Google account to track your submissions.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-[var(--border)] pb-7">
        <p className="eyebrow text-[var(--impact)]">Workspace</p>
        <div className="mt-3 flex items-start gap-3">
          <ClipboardList
            className="mt-1 size-7 shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
          <div>
            <h1 className="display-heading text-4xl font-semibold">
              My submissions
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-[var(--ink-muted)]">
              Track review status and reviewer remarks. You will also be emailed
              when a decision is recorded.
            </p>
          </div>
        </div>
      </header>
      <section aria-label="Submission status" className="space-y-4">
        {mine.isLoading && (
          <p className="text-sm text-[var(--ink-muted)]">
            Loading your submissions…
          </p>
        )}
        {mine.isError && (
          <p
            role="alert"
            className="border-l-2 border-[var(--impact-red)] bg-white px-4 py-3 text-sm text-[var(--impact-red)]"
          >
            {mine.error instanceof ApiError
              ? mine.error.message
              : 'Your submissions could not be loaded.'}
          </p>
        )}
        {mine.data?.length === 0 && (
          <div className="border-t-2 border-[var(--primary)] bg-white p-6">
            <p className="font-semibold">No submissions yet.</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Start your repository record by{' '}
              <Link to="/submit" className="underline underline-offset-4">
                Submit research
              </Link>
              .
            </p>
          </div>
        )}
        {mine.data && mine.data.length > 0 && (
          <>
            <div className="grid gap-4 border-y border-[var(--border)] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
              <label
                className="space-y-2 text-sm font-medium"
                htmlFor="submission-search"
              >
                <span className="flex items-center gap-2">
                  <Search className="size-4" aria-hidden="true" />
                  Find a submission
                </span>
                <Input
                  id="submission-search"
                  type="search"
                  placeholder="Search title or author"
                  value={search}
                  onChange={(event) => updateFilter('q', event.target.value)}
                />
              </label>
              <label
                className="space-y-2 text-sm font-medium"
                htmlFor="submission-status"
              >
                Status
                <Select
                  value={status}
                  onValueChange={(value) =>
                    updateFilter('status', value ?? 'ALL')
                  }
                  items={STATUS_OPTIONS.map((option) => ({ ...option }))}
                >
                  <SelectTrigger id="submission-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <p className="text-sm text-[var(--ink-muted)]" aria-live="polite">
              Showing {filtered.length} of {mine.data.length} submissions
            </p>
          </>
        )}
        {mine.data && mine.data.length > 0 && visibleItems.length === 0 && (
          <div className="border-t-2 border-[var(--primary)] bg-white p-6">
            <p className="font-semibold">No submissions match these filters.</p>
            <button
              type="button"
              className="mt-2 text-sm underline underline-offset-4"
              onClick={() => setParams({})}
            >
              Clear filters
            </button>
          </div>
        )}
        {visibleItems.map((item) => (
          <article
            key={item.id}
            className="space-y-4 border-t-2 border-[var(--primary)] bg-white p-5 sm:p-6"
          >
            <div className="space-y-3">
              <h2 className="display-heading text-2xl font-semibold leading-tight">
                {item.title}
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLE[item.status]}`}
              >
                {item.status === 'PENDING' ? (
                  <Clock3 className="size-3.5" aria-hidden="true" />
                ) : item.status === 'ACCEPTED' ? (
                  <CircleCheck className="size-3.5" aria-hidden="true" />
                ) : (
                  <CircleX className="size-3.5" aria-hidden="true" />
                )}
                {STATUS_LABEL[item.status]}
              </span>
            </div>
            <p className="text-sm text-[var(--ink-muted)]">
              {item.authors || 'Authors not listed'}
              {item.status === 'ACCEPTED' && item.year
                ? ` · Accepted ${item.year}`
                : ''}
              {' · '}
              Submitted {new Date(item.createdAt).toLocaleDateString()}
            </p>
            {(item.keywords ?? []).length > 0 && (
              <>
                <span className="sr-only">
                  Keywords: {(item.keywords ?? []).join('; ')}
                </span>
                <div
                  className="flex flex-wrap gap-2"
                  aria-label={`Keywords: ${(item.keywords ?? []).join('; ')}`}
                >
                  {(item.keywords ?? []).map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </>
            )}
            {item.remarks && (
              <p className="whitespace-pre-wrap border-l-2 border-[var(--archive-gold)] pl-4 text-sm leading-6">
                <span className="font-medium">Reviewer remarks: </span>
                {item.remarks}
              </p>
            )}
            {item.status === 'ACCEPTED' && item.recordId && (
              <p className="border-t border-[var(--border)] pt-4 text-sm text-[var(--ink-muted)]">
                Published to the repository
                {item.embargoUntil
                  ? ` with access restrictions until ${item.embargoUntil}`
                  : ''}
                .
              </p>
            )}
          </article>
        ))}
        {filtered.length > PAGE_SIZE && (
          <nav
            className="flex items-center justify-between border-t border-[var(--border)] pt-4"
            aria-label="Submission pages"
          >
            <button
              type="button"
              className="rounded border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              disabled={currentPage === 1}
              onClick={() => goToPage(currentPage - 1)}
            >
              Previous
            </button>
            <span className="text-sm text-[var(--ink-muted)]">
              Page {currentPage} of {pageCount}
            </span>
            <button
              type="button"
              className="rounded border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              disabled={currentPage === pageCount}
              onClick={() => goToPage(currentPage + 1)}
            >
              Next
            </button>
          </nav>
        )}
      </section>
    </div>
  )
}
