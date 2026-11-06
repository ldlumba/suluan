import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  CloudCog,
  GraduationCap,
  Network,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch, ApiError } from '@/lib/api'
import { NotificationRefresh } from '@/features/operations/NotificationRefresh'

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

export function AdminTool({
  to,
  icon,
  title,
  description,
  attention,
}: {
  to: string
  icon: ReactNode
  title: string
  description: string
  attention?: string
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-[var(--border)] border-t-2 border-t-[var(--primary)] bg-white p-5 transition duration-150 hover:-translate-y-0.5 hover:bg-[var(--secondary)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transform-none"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="text-[var(--primary)] [&_svg]:size-5">{icon}</span>
        <ArrowUpRight
          className="size-4 text-[var(--ink-muted)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
      <h3 className="mt-4 flex items-center gap-2 font-semibold">
        {title}
        {attention && (
          <>
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full bg-red-600"
            />
            <span className="sr-only">{attention}</span>
          </>
        )}
      </h3>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
        {description}
      </p>
    </Link>
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
  const reviewQueue = useQuery({
    queryKey: ['review-queue'],
    enabled: profile?.role === 'ADMIN',
    retry: false,
    queryFn: async () =>
      apiFetch<unknown[]>('/api/review/queue', await getIdToken()),
  })

  if (loading) return <p role="status">Checking access…</p>
  if (!user) return <p>Sign in to open the administrator dashboard.</p>
  if (profile?.role !== 'ADMIN') {
    return <p>Only administrators can open this dashboard.</p>
  }
  if (
    [users.error, operations.error, activity.error].some(
      (error) => error instanceof ApiError && error.status === 403,
    )
  )
    return <NotFoundPage />

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
              Review submissions, manage accepted papers and accounts, and check
              how papers are being prepared for search.
            </p>
          </div>
        </div>
      </header>

      <section aria-labelledby="admin-tools-heading" className="space-y-4">
        <div>
          <h2 id="admin-tools-heading" className="text-xl font-semibold">
            Administration tools
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Choose a task to get started.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AdminTool
            to="/direct-upload"
            icon={<BookOpenCheck aria-hidden="true" />}
            title="Upload and accept a paper"
            description="Add an authorized paper directly to the repository and choose who can access it."
          />
          <AdminTool
            to="/review"
            icon={<BookOpenCheck aria-hidden="true" />}
            title="Review submissions"
            attention={
              reviewQueue.data?.length
                ? 'Submissions awaiting review'
                : undefined
            }
            description="Read submitted papers and accept or reject them with remarks."
          />
          <AdminTool
            to="/operations"
            icon={<CloudCog aria-hidden="true" />}
            title="Prepare papers for search"
            attention={
              pipeline &&
              (pipeline.queuedExtraction ||
                pipeline.failedExtraction ||
                pipeline.unindexedRecords ||
                pipeline.missingEmbeddingChunks)
                ? 'Papers awaiting preparation'
                : undefined
            }
            description="Check progress and start preparing accepted papers for keyword and semantic search."
          />
          <AdminTool
            to="/access-review"
            icon={<ShieldCheck aria-hidden="true" />}
            title="Manage papers"
            description="Find accepted papers, change access or keywords, and withdraw or reinstate papers."
          />
          <AdminTool
            to="/graph/analytics"
            icon={<Network aria-hidden="true" />}
            title="Explore research trends"
            description="See research topics and how papers are distributed across programs and years."
          />
          <AdminTool
            to="/admin/users"
            icon={<UserCog aria-hidden="true" />}
            title="Manage account roles"
            description="View accounts and assign user, repository manager, or administrator roles."
          />
          <AdminTool
            to="/admin/catalog"
            icon={<GraduationCap aria-hidden="true" />}
            title="Manage programs"
            description="Show or hide programs in the form for new submissions."
          />
        </div>
        {reviewQueue.isError && (
          <p role="status" className="text-sm text-[var(--ink-muted)]">
            Submission review status is unavailable.
          </p>
        )}
      </section>

      <NotificationRefresh />
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
            Paper preparation
          </h2>
          <Link
            to="/operations"
            className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4"
          >
            Prepare papers{' '}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        {operations.isError ? (
          <p role="alert" className="text-sm text-[var(--impact-red)]">
            Paper preparation details are unavailable.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Waiting or failed"
              value={operations.isPending ? '…' : (needsAttention ?? 0)}
              detail="Papers waiting for preparation or needing a retry after a failure"
            />
            <Metric
              label="Awaiting search preparation"
              value={
                operations.isPending ? '…' : (pipeline?.unindexedRecords ?? 0)
              }
              detail="Papers not yet ready for keyword search"
            />
            <Metric
              label="Sections awaiting semantic search"
              value={
                operations.isPending
                  ? '…'
                  : (pipeline?.missingEmbeddingChunks ?? 0)
              }
              detail={
                pipeline
                  ? `${pipeline.missingEmbeddingRecords} papers need semantic search preparation`
                  : 'Papers needing semantic search preparation'
              }
            />
            <Metric
              label="Semantic preparation requests"
              value={
                operations.isPending
                  ? '…'
                  : `${operations.data?.embeddingQuota.requestsUsed ?? 0}/${operations.data?.embeddingQuota.requestsLimit ?? 0}`
              }
              detail="Requests used out of the daily limit (UTC)"
            />
          </div>
        )}
      </section>

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
              label="Accounts shown"
              value={users.isPending ? '…' : accounts.length}
              detail="Up to 500 account profiles"
            />
            <Metric
              label="Managers and admins"
              value={users.isPending ? '…' : managers}
              detail="Among the accounts shown"
            />
            <Metric
              label="Administrators"
              value={
                users.isPending
                  ? '…'
                  : accounts.filter((account) => account.role === 'ADMIN')
                      .length
              }
              detail="Among the accounts shown; the last admin cannot lose admin access"
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
            Activity from signed-in users
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Activity from the last 90 days. Signed-out visitors are not tracked.
            Repeated actions by the same user on the same paper are counted at
            most once every 24 hours.
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
              detail={
                activity.data
                  ? `${activity.data.viewers} signed-in viewers`
                  : 'Signed-in viewers'
              }
            />
            <Metric
              label="Papers viewed"
              value={
                activity.isPending ? '…' : (activity.data?.viewedPapers ?? 0)
              }
              detail="Different papers viewed"
            />
            <Metric
              label="Citations copied"
              value={
                activity.isPending ? '…' : (activity.data?.citationCopies ?? 0)
              }
              detail="Copy actions, not academic citations"
            />
            <Metric
              label="Download starts"
              value={
                activity.isPending ? '…' : (activity.data?.downloadStarts ?? 0)
              }
              detail="Downloads started; completion is not tracked"
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
            These are summary counts. Open the tools above to manage accounts
            and paper preparation.
          </p>
        </div>
      </section>
    </section>
  )
}
