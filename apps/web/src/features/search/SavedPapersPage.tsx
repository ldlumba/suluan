import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bookmark } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch, ApiError } from '@/lib/api'

interface SavedPaper {
  bookmarkId: string
  id: string
  title: string
  authors: string | null
  year: string | null
  schoolName: string | null
  courseName: string | null
}

export function SavedPapersPage() {
  const { getIdToken } = useAuth()
  const saved = useQuery({
    queryKey: ['bookmarks'],
    retry: false,
    queryFn: async () =>
      apiFetch<SavedPaper[]>('/api/bookmarks', await getIdToken()),
  })

  if (saved.isPending) return <p role="status">Loading saved papers…</p>
  if (saved.isError) {
    return (
      <p
        role="alert"
        className="border-l-2 border-[var(--impact-red)] bg-white px-4 py-3 text-sm text-[var(--impact-red)]"
      >
        {saved.error instanceof ApiError
          ? saved.error.message
          : 'Saved papers could not be loaded.'}
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-[var(--border)] pb-7">
        <p className="eyebrow text-[var(--impact)]">Workspace</p>
        <div className="mt-3 flex items-start gap-3">
          <Bookmark
            className="mt-1 size-7 shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
          <div>
            <h1 className="display-heading text-4xl font-semibold">
              Saved papers
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-[var(--ink-muted)]">
              Keep a private reading list of papers you want to revisit.
            </p>
          </div>
        </div>
      </header>
      {saved.data.length === 0 ? (
        <div className="border-t-2 border-[var(--primary)] bg-white p-6">
          <p className="font-semibold">No saved papers yet.</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Use <strong>Save paper</strong> on a repository record to build your
            reading list.
          </p>
          <Link
            to="/search"
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Browse the
            repository
          </Link>
        </div>
      ) : (
        <ul className="space-y-4" aria-label="Saved papers">
          {saved.data.map((paper) => (
            <li
              key={paper.bookmarkId}
              className="border-t-2 border-[var(--primary)] bg-white p-5 sm:p-6"
            >
              <h2 className="display-heading text-2xl font-semibold leading-tight">
                <Link
                  to={`/records/${paper.id}`}
                  className="underline-offset-4 hover:text-[var(--signal-blue)] hover:underline"
                >
                  {paper.title}
                </Link>
              </h2>
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                {paper.authors || 'Authors not listed'} ·{' '}
                {paper.year || 'Year not listed'}
              </p>
              {(paper.schoolName || paper.courseName) && (
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {paper.schoolName || 'School not listed'} ·{' '}
                  {paper.courseName || 'Course not listed'}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
