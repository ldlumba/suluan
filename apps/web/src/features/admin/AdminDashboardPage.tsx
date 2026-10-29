import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, ShieldCheck, Users } from 'lucide-react'
import { Link } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch, ApiError } from '@/lib/api'

type Role = 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN'
interface UserRow {
  id: string
  role: Role
}
interface OperationsStatus {
  pipeline: {
    queuedExtraction: number
    processingExtraction: number
    failedExtraction: number
    unindexedRecords: number
    missingEmbeddingRecords: number
    missingEmbeddingChunks: number
  }
  embeddingQuota: {
    requestsUsed: number
    requestsLimit: number
    inputsUsed: number
    inputsLimit: number
  }
  dispatcherConfigured: boolean
}
interface ActivitySummary {
  paperViews: number
  citationCopies: number
  downloadStarts: number
  viewers: number
  viewedPapers: number
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail: string
}) {
  return (
    <div className="border-t-2 border-[var(--primary)] bg-white p-5">
      <p className="text-sm text-[var(--ink-muted)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">{detail}</p>
    </div>
  )
}

export function AdminDashboardPage() {
  const { user, profile, loading, getIdToken } = useAuth()
  const users = useQuery({
    queryKey: ['admin-users', 'dashboard', profile?.id],
    enabled: profile?.role === 'ADMIN',
    retry: false,
    queryFn: async () =>
      apiFetch<UserRow[]>('/api/admin/users', await getIdToken()),
  })
  const operations = useQuery({
    queryKey: ['repository-operations', 'dashboard'],
    enabled: profile?.role === 'ADMIN',
    retry: false,
    queryFn: async () =>
      apiFetch<OperationsStatus>(
        '/api/repository-operations/status',
        await getIdToken(),
      ),
  })
  const activity = useQuery({
    queryKey: ['admin-activity', profile?.id],
    enabled: profile?.role === 'ADMIN',
    retry: false,
    queryFn: async () =>
      apiFetch<ActivitySummary>('/api/admin/activity', await getIdToken()),
  })

  if (loading) return <p role="status">Checking access…</p>
  if (!user) return <p>Sign in to open the administrator dashboard.</p>
  if (profile?.role !== 'ADMIN') {
    return <p>Only administrators can open this dashboard.</p>
  }

  const accounts = users.data ?? []
  const managers = accounts.filter((account) => account.role !== 'USER').length
  const pipeline = operations.data?.pipeline
  const needsAttention = pipeline
    ? pipeline.failedExtraction + pipeline.queuedExtraction
    : null

  return (
    <section className="space-y-8">
      <header className="border-b border-[var(--border)] pb-7">
        <p className="eyebrow text-[var(--impact)]">Administration</p>
        <div className="mt-3 flex items-start gap-3">
          <ShieldCheck
            className="mt-1 size-7 shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
          <div>
            <h1 className="display-heading text-4xl font-semibold">
              Admin dashboard
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--ink-muted)]">
              A read-only overview of admitted accounts and repository pipeline
              health. Actions remain in their dedicated, audited workspaces.
            </p>
          </div>
        </div>
      </header>

      <section aria-labelledby="account-overview-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="account-overview-heading" className="text-xl font-semibold">
            Account overview
          </h2>
          <Link
            to="/admin/users"
            className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4"
          >
            Manage roles <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {users.isError ? (
          <p role="alert" className="text-sm text-[var(--impact-red)]">
            {users.error instanceof ApiError
              ? users.error.message
              : 'Account data is unavailable.'}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Admitted accounts"
              value={users.isPending ? '…' : accounts.length}
              detail="Profiles with a server-side role"
            />
            <Metric
              label="Managers and admins"
              value={users.isPending ? '…' : managers}
              detail="Elevated repository access"
            />
            <Metric
              label="Administrators"
              value={
                users.isPending
                  ? '…'
                  : accounts.filter((account) => account.role === 'ADMIN')
                      .length
              }
              detail="Protected by last-admin guard"
            />
          </div>
        )}
      </section>

      <section
        aria-labelledby="pipeline-overview-heading"
        className="space-y-4"
      >
        <div className="flex items-center justify-between gap-4">
          <h2
            id="pipeline-overview-heading"
            className="flex items-center gap-2 text-xl font-semibold"
          >
            <Activity
              className="size-5 text-[var(--primary)]"
              aria-hidden="true"
            />{' '}
            Repository pipeline
          </h2>
          <Link
            to="/operations"
            className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4"
          >
            Open operations{' '}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {operations.isError ? (
          <p role="alert" className="text-sm text-[var(--impact-red)]">
            Pipeline data is unavailable.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Needs attention"
              value={operations.isPending ? '…' : (needsAttention ?? 0)}
              detail="Queued or failed extraction jobs"
            />
            <Metric
              label="Awaiting indexing"
              value={
                operations.isPending ? '…' : (pipeline?.unindexedRecords ?? 0)
              }
              detail="Extracted records without keyword snapshots"
            />
            <Metric
              label="Missing vectors"
              value={
                operations.isPending
                  ? '…'
                  : (pipeline?.missingEmbeddingChunks ?? 0)
              }
              detail={`${pipeline?.missingEmbeddingRecords ?? 0} papers need embedding work`}
            />
            <Metric
              label="Embedding requests"
              value={
                operations.isPending
                  ? '…'
                  : `${operations.data?.embeddingQuota.requestsUsed ?? 0}/${operations.data?.embeddingQuota.requestsLimit ?? 0}`
              }
              detail="Current daily quota usage"
            />
          </div>
        )}
      </section>

      <section
        aria-labelledby="activity-overview-heading"
        className="space-y-4"
      >
        <div>
          <h2 id="activity-overview-heading" className="text-xl font-semibold">
            Authenticated activity
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Aggregate events from the last 90 days. Public visitors are not
            tracked.
          </p>
        </div>
        {activity.isError ? (
          <p role="alert" className="text-sm text-[var(--impact-red)]">
            Activity data is unavailable.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Paper views"
              value={
                activity.isPending ? '…' : (activity.data?.paperViews ?? 0)
              }
              detail={`${activity.data?.viewers ?? 0} authenticated viewers`}
            />
            <Metric
              label="Papers viewed"
              value={
                activity.isPending ? '…' : (activity.data?.viewedPapers ?? 0)
              }
              detail="Distinct visible records"
            />
            <Metric
              label="Citation-copy count"
              value={
                activity.isPending ? '…' : (activity.data?.citationCopies ?? 0)
              }
              detail="Deduplicated per user and paper"
            />
            <Metric
              label="Download starts"
              value={
                activity.isPending ? '…' : (activity.data?.downloadStarts ?? 0)
              }
              detail="Authorized starts, not completion"
            />
          </div>
        )}
      </section>

      <section className="border-t border-[var(--border)] pt-6">
        <div className="flex items-start gap-3 text-sm text-[var(--ink-muted)]">
          <Users
            className="mt-0.5 size-4 shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
          <p>
            Dashboard metrics are aggregate operational counts. Detailed account
            changes and pipeline launches remain available only in their
            authorized management views.
          </p>
        </div>
      </section>
    </section>
  )
}
