import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
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
      <Card>
        <CardContent className="pt-6 text-sm">
          <Link to="/signin" className="underline underline-offset-4">
            Sign in
          </Link>{' '}
          with your UA Google account to track your submissions.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold tracking-tight">
          My submissions
        </h1>
        <CardDescription>
          Status and reviewer remarks for papers you submitted. You will also be
          emailed when a decision is recorded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mine.isLoading && (
          <p className="text-sm text-muted-foreground">
            Loading your submissions…
          </p>
        )}
        {mine.isError && (
          <p role="alert" className="text-sm text-destructive">
            {mine.error instanceof ApiError
              ? mine.error.message
              : 'Your submissions could not be loaded.'}
          </p>
        )}
        {mine.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            You have not submitted any papers yet.{' '}
            <Link to="/submit" className="underline underline-offset-4">
              Submit research
            </Link>
          </p>
        )}
        {mine.data?.map((item) => (
          <div key={item.id} className="space-y-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{item.title}</span>
              <span className="rounded border px-2 py-0.5 text-xs">
                {STATUS_LABEL[item.status]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {item.authors || 'Authors not listed'}
              {item.status === 'ACCEPTED' && item.year
                ? ` · Accepted ${item.year}`
                : ''}
              {' · '}
              Submitted {new Date(item.createdAt).toLocaleDateString()}
            </p>
            {(item.keywords ?? []).length > 0 && (
              <p className="text-sm text-muted-foreground">
                Keywords: {(item.keywords ?? []).join('; ')}
              </p>
            )}
            {item.remarks && (
              <p className="whitespace-pre-wrap text-sm">
                <span className="font-medium">Reviewer remarks: </span>
                {item.remarks}
              </p>
            )}
            {item.status === 'ACCEPTED' && item.recordId && (
              <p className="text-sm text-muted-foreground">
                Published to the repository
                {item.embargoUntil
                  ? ` with access restrictions until ${item.embargoUntil}`
                  : ''}
                .
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
