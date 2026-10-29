import { useQuery } from '@tanstack/react-query'
import { BookOpenCheck, CloudCog, Network, ShieldCheck } from 'lucide-react'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { AdminTool } from '@/features/admin/AdminDashboardPage'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

interface PreparationStatus {
  pipeline: {
    queuedExtraction: number
    processingExtraction: number
    failedExtraction: number
    unindexedRecords: number
  }
}

export function ManagerDashboardPage() {
  const { profile, getIdToken } = useAuth()
  const status = useQuery({
    queryKey: ['manager-dashboard', profile?.id],
    enabled: profile?.role === 'REPOSITORY_MANAGER',
    retry: false,
    queryFn: async () =>
      apiFetch<PreparationStatus>(
        '/api/repository-operations/status',
        await getIdToken(),
      ),
  })

  if (status.error instanceof ApiError && status.error.status === 403)
    return <NotFoundPage />

  return (
    <section className="space-y-8">
      <header className="border-b border-[var(--border)] pb-7">
        <p className="eyebrow text-[var(--impact)]">Repository workspace</p>
        <div className="mt-3 flex items-start gap-3">
          <ShieldCheck
            className="mt-1 size-7 shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
          <div>
            <h1 className="display-heading text-4xl font-semibold">
              Repository manager dashboard
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-[var(--ink-muted)]">
              Review submissions, prepare papers for search, and explore
              research trends.
            </p>
          </div>
        </div>
      </header>
      <section aria-labelledby="manager-tools-heading" className="space-y-4">
        <h2 id="manager-tools-heading" className="text-xl font-semibold">
          Your tools
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AdminTool
            to="/review"
            icon={<BookOpenCheck aria-hidden="true" />}
            title="Review submissions"
            description="Read submitted papers and record your decisions."
          />
          <AdminTool
            to="/operations"
            icon={<CloudCog aria-hidden="true" />}
            title="Prepare papers for search"
            description="Check paper processing and start preparation when needed."
          />
          <AdminTool
            to="/graph/analytics"
            icon={<Network aria-hidden="true" />}
            title="Explore research trends"
            description="See research topics, courses, and years in the repository."
          />
        </div>
      </section>
      <section
        aria-labelledby="manager-preparation-heading"
        className="space-y-4"
      >
        <h2 id="manager-preparation-heading" className="text-xl font-semibold">
          Paper preparation
        </h2>
        {status.isPending ? (
          <p role="status">Loading preparation details…</p>
        ) : status.isError ? (
          <p role="alert">Paper preparation details are unavailable.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                label: 'Waiting for preparation',
                value: status.data.pipeline.queuedExtraction,
              },
              {
                label: 'Being prepared',
                value: status.data.pipeline.processingExtraction,
              },
              {
                label: 'Need a retry',
                value: status.data.pipeline.failedExtraction,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="border-t-2 border-[var(--primary)] bg-white p-5"
              >
                <p className="text-sm text-[var(--ink-muted)]">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
