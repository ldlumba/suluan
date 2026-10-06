import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ClipboardList, Clock3, CircleCheck, CircleX } from 'lucide-react'
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
  REJECTED: 'Not accepted',
}

/**
 * Submitter status view (owner-approved 2026-10-01). Shows only the signed-in
 * submitter's own submissions, their authoritative status, and reviewer
 * remarks. It grants NO document access — downloads remain manager-gated.
 */
export function MySubmissionsPage() {
  const { user, profile, loading, getIdToken } = useAuth()
  const mine = useQuery({
    queryKey: ['my-submissions', profile?.id],
    enabled: user !== null,
    retry: false,
    queryFn: async () =>
      apiFetch<MySubmission[]>('/api/submissions/mine', await getIdToken()),
  })

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
        {mine.data?.map((item) => (
          <article
            key={item.id}
            className="space-y-4 border-t-2 border-[var(--primary)] bg-white p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="display-heading mr-auto text-2xl font-semibold leading-tight">
                {item.title}
              </h2>
              <span className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold">
                {item.status === 'PENDING' ? (
                  <Clock3 className="size-3.5" aria-hidden="true" />
                ) : item.status === 'ACCEPTED' ? (
                  <CircleCheck
                    className="size-3.5 text-[var(--signal-blue)]"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleX
                    className="size-3.5 text-[var(--impact-red)]"
                    aria-hidden="true"
                  />
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
      </section>
    </div>
  )
}
