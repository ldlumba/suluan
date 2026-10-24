import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Braces,
  CircleCheck,
  CircleX,
  CloudCog,
  FileSearch,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

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
  recentRuns: {
    id: string
    action: 'EXTRACTION' | 'EMBEDDING'
    status: 'REQUESTED' | 'DISPATCHING' | 'LAUNCHED' | 'FAILED'
    executionName: string | null
    errorCode: string | null
    createdAt: string
    updatedAt: string
  }[]
}

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'The operation could not be started.'
}

export function RepositoryOperationsPage() {
  const { user, profile, loading, getIdToken } = useAuth()
  const [confirmEmbedding, setConfirmEmbedding] = useState(false)
  const isManager = profile !== null && profile.role !== 'USER'
  const status = useQuery({
    queryKey: ['repository-operations'],
    enabled: isManager,
    retry: false,
    queryFn: async () =>
      apiFetch<OperationsStatus>(
        '/api/repository-operations/status',
        await getIdToken(),
      ),
  })

  const extraction = useMutation({
    mutationFn: async () =>
      apiFetch('/api/repository-operations/extraction', await getIdToken(), {
        method: 'POST',
      }),
    onSuccess: () => void status.refetch(),
  })
  const indexing = useMutation({
    mutationFn: async () =>
      apiFetch<{ indexed: number; hasMore: boolean }>(
        '/api/repository-operations/index',
        await getIdToken(),
        { method: 'POST' },
      ),
    onSuccess: () => void status.refetch(),
  })
  const embedding = useMutation({
    mutationFn: async () =>
      apiFetch('/api/repository-operations/embedding', await getIdToken(), {
        method: 'POST',
      }),
    onSuccess: () => {
      setConfirmEmbedding(false)
      void status.refetch()
    },
  })

  if (loading) return <p role="status">Checking access…</p>
  if (!user) return <p>Sign in to open repository operations.</p>
  if (!isManager)
    return (
      <p>
        Only repository managers and administrators can run repository
        operations.
      </p>
    )

  const data = status.data
  const busy = extraction.isPending || indexing.isPending || embedding.isPending
  const quotaRemaining = data
    ? Math.min(
        data.embeddingQuota.requestsLimit - data.embeddingQuota.requestsUsed,
        data.embeddingQuota.inputsLimit - data.embeddingQuota.inputsUsed,
      )
    : 0

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <CloudCog
              className="size-7 text-[var(--primary)]"
              aria-hidden="true"
            />
            <h1 className="display-heading text-4xl font-semibold">
              Repository operations
            </h1>
          </div>
          <p className="mt-3 max-w-3xl leading-7 text-[var(--ink-muted)]">
            Advance accepted papers without waiting for the three-hour fallback.
            Each action is bounded, audited, and safe to refresh after launch.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={status.isFetching}
          onClick={() => void status.refetch()}
        >
          <RefreshCw
            className={`size-4 ${status.isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh status
        </Button>
      </header>

      {status.isPending && <p role="status">Loading pipeline status…</p>}
      {status.isError && (
        <p role="alert" className="text-destructive">
          Pipeline status could not be loaded.
        </p>
      )}
      {[extraction, indexing, embedding].map((mutation, index) =>
        mutation.isError ? (
          <p key={index} role="alert" className="text-destructive">
            {errorMessage(mutation.error)}
          </p>
        ) : null,
      )}
      {extraction.isSuccess && (
        <p role="status" className="text-sm text-[var(--primary)]">
          Extraction was launched. Refresh status to follow pipeline progress.
        </p>
      )}
      {indexing.isSuccess && (
        <p role="status" className="text-sm text-[var(--primary)]">
          Prepared {indexing.data.indexed} paper
          {indexing.data.indexed === 1 ? '' : 's'} for keyword search.
        </p>
      )}
      {embedding.isSuccess && (
        <p role="status" className="text-sm text-[var(--primary)]">
          Semantic embedding was launched. Refresh status after the job runs.
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            <OperationCard
              icon={<FileSearch />}
              eyebrow="Step 01"
              title="Extract documents"
              count={data.pipeline.queuedExtraction}
              unit="queued"
              detail={`${data.pipeline.processingExtraction} processing · ${data.pipeline.failedExtraction} failed`}
              action="Run extraction"
              disabled={
                busy ||
                !data.dispatcherConfigured ||
                data.pipeline.queuedExtraction === 0
              }
              pending={extraction.isPending}
              onClick={() => extraction.mutate()}
            />
            <OperationCard
              icon={<Braces />}
              eyebrow="Step 02"
              title="Prepare keyword search"
              count={data.pipeline.unindexedRecords}
              unit="ready to index"
              detail="Up to 50 extracted papers per run · no model charge"
              action="Prepare keyword search"
              disabled={busy || data.pipeline.unindexedRecords === 0}
              pending={indexing.isPending}
              onClick={() => indexing.mutate()}
            />
            <OperationCard
              icon={<Sparkles />}
              eyebrow="Step 03"
              title="Build semantic vectors"
              count={data.pipeline.missingEmbeddingChunks}
              unit={`chunks across ${data.pipeline.missingEmbeddingRecords} papers`}
              detail={`${data.embeddingQuota.requestsUsed}/${data.embeddingQuota.requestsLimit} requests · ${data.embeddingQuota.inputsUsed}/${data.embeddingQuota.inputsLimit} inputs today`}
              action="Run semantic embedding"
              disabled={
                busy ||
                !data.dispatcherConfigured ||
                data.pipeline.missingEmbeddingChunks === 0 ||
                quotaRemaining <= 0
              }
              pending={embedding.isPending}
              onClick={() => setConfirmEmbedding(true)}
            />
          </div>

          <section
            aria-labelledby="recent-operations-heading"
            className="border-t border-border pt-7"
          >
            <h2
              id="recent-operations-heading"
              className="text-xl font-semibold"
            >
              Recent manual launches
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              A launch confirms that Cloud Run accepted the job. Refresh the
              counters to verify pipeline progress.
            </p>
            {data.recentRuns.length === 0 ? (
              <p className="mt-5 border-l-2 border-[var(--highlight)] pl-4 text-sm text-[var(--ink-muted)]">
                No manual jobs have been launched yet.
              </p>
            ) : (
              <ul className="mt-5 divide-y divide-border border-y border-border">
                {data.recentRuns.map((run) => (
                  <li
                    key={run.id}
                    className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      {run.status === 'FAILED' ? (
                        <CircleX
                          className="size-5 text-destructive"
                          aria-hidden="true"
                        />
                      ) : (
                        <CircleCheck
                          className="size-5 text-[var(--primary)]"
                          aria-hidden="true"
                        />
                      )}
                      <div>
                        <p className="font-medium">
                          {run.action === 'EXTRACTION'
                            ? 'Document extraction'
                            : 'Semantic embedding'}
                        </p>
                        <p className="text-sm text-[var(--ink-muted)]">
                          {new Date(run.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold capitalize">
                      {run.status.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Dialog open={confirmEmbedding} onOpenChange={setConfirmEmbedding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run one semantic embedding claim?</DialogTitle>
            <DialogDescription>
              This starts one region-pinned job for at most 20 missing chunks
              from one paper. It can consume one Gemini request and does not
              retry automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmEmbedding(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={embedding.isPending}
              onClick={() => embedding.mutate()}
            >
              {embedding.isPending ? 'Starting…' : 'Start bounded job'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function OperationCard({
  icon,
  eyebrow,
  title,
  count,
  unit,
  detail,
  action,
  disabled,
  pending,
  onClick,
}: {
  icon: ReactNode
  eyebrow: string
  title: string
  count: number
  unit: string
  detail: string
  action: string
  disabled: boolean
  pending: boolean
  onClick: () => void
}) {
  return (
    <article className="flex min-h-72 flex-col border-t-2 border-[var(--primary)] bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
          {eyebrow}
        </span>
        <span
          className="text-[var(--primary)] [&>svg]:size-6"
          aria-hidden="true"
        >
          {icon}
        </span>
      </div>
      <h2 className="mt-5 text-xl font-semibold">{title}</h2>
      <p className="mt-4">
        <span className="display-heading text-4xl font-semibold">{count}</span>{' '}
        <span className="text-sm text-[var(--ink-muted)]">{unit}</span>
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{detail}</p>
      <Button className="mt-auto w-full" disabled={disabled} onClick={onClick}>
        {pending ? 'Starting…' : action}
      </Button>
    </article>
  )
}
