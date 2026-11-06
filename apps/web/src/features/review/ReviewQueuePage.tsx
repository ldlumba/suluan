import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  CircleAlert,
  ClipboardCheck,
  BookOpen,
  Download,
  FileText,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiDownload, apiFetch } from '@/lib/api'
import { useAuth } from '@/features/auth/useAuth'
import { NotFoundPage } from '@/app/pages/NotFoundPage'

interface QueueItem {
  id: string
  title: string
  authors: string | null
  createdAt: string
  submitterEmail: string | null
  keywords: string[]
  possibleDuplicate: boolean
  duplicateOf: {
    id: string
    title: string
    status: string
    createdAt: string
    submitterEmail: string | null
  }[]
  files: {
    fileName: string
    mimeType: string | null
    sizeBytes: number | null
  }[]
}

function formatBytes(size: number | null): string {
  if (size === null || size === undefined) return 'unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function ReviewQueuePage() {
  const { user, profile, loading, getIdToken } = useAuth()
  const queryClient = useQueryClient()
  const [deciding, setDeciding] = useState<QueueItem | null>(null)
  const [remarks, setRemarks] = useState('')
  const [confirmDecision, setConfirmDecision] = useState<
    'ACCEPTED' | 'REJECTED' | null
  >(null)
  const [decideError, setDecideError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [reading, setReading] = useState<QueueItem | null>(null)
  const [readerUrl, setReaderUrl] = useState<string | null>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [readerError, setReaderError] = useState('')
  const readerGeneration = useRef(0)
  useEffect(
    () => () => {
      readerGeneration.current += 1
    },
    [],
  )
  useEffect(
    () => () => {
      if (readerUrl) URL.revokeObjectURL(readerUrl)
    },
    [readerUrl],
  )
  // Visibility defaults to PUBLIC so accepting never silently hides a paper.
  const [visibility, setVisibility] = useState<
    'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
  >('PUBLIC')
  const [embargoUntil, setEmbargoUntil] = useState('')

  const VISIBILITY_OPTIONS = [
    { value: 'PUBLIC', label: 'Public — anyone can read and download' },
    { value: 'UA_ONLY', label: 'University access — UA sign-in required' },
    { value: 'RESTRICTED', label: 'Restricted — repository managers only' },
  ] as const

  function resetDecisionFields() {
    setConfirmDecision(null)
    setRemarks('')
    setDecideError(null)
    setVisibility('PUBLIC')
    setEmbargoUntil('')
  }

  const isManager = profile !== null && profile.role !== 'USER'
  const queueQuery = useQuery({
    queryKey: ['review-queue'],
    queryFn: async () => {
      const token = await getIdToken()
      return apiFetch<QueueItem[]>('/api/review/queue', token)
    },
    enabled: isManager,
  })

  const decideMutation = useMutation({
    mutationFn: async (input: {
      submissionId: string
      status: 'ACCEPTED' | 'REJECTED'
      remarks: string
      visibility?: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
      embargoUntil?: string
    }) => {
      const token = await getIdToken()
      return apiFetch<{ id: string; status: string }>('/api/decisions', token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
    },
    onSuccess: () => {
      setDeciding(null)
      resetDecisionFields()
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    },
    onError: (err) => {
      setDecideError(
        err instanceof ApiError
          ? err.message
          : 'The decision could not be recorded.',
      )
    },
  })

  if (loading)
    return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
  if (!user)
    return <p className="text-sm text-muted-foreground">Sign in to continue.</p>
  if (profile !== null && !isManager) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm">
          Only repository managers can review submissions. Your account does not
          have that role.
        </CardContent>
      </Card>
    )
  }
  if (profile === null) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm">
          Your permissions could not be loaded. Please sign out and sign in
          again.
        </CardContent>
      </Card>
    )
  }
  if (
    [queueQuery.error, decideMutation.error].some(
      (error) => error instanceof ApiError && error.status === 403,
    )
  )
    return <NotFoundPage />

  async function download(item: QueueItem) {
    setDownloadError(null)
    try {
      const token = await getIdToken()
      const { blob, fileName } = await apiDownload(
        `/api/submissions/${item.id}/download`,
        token,
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Revoke after the browser has had a chance to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setDownloadError(
        err instanceof ApiError ? err.message : 'The download failed.',
      )
    }
  }

  async function openReader(item: QueueItem) {
    if (readerLoading) return
    setReading(item)
    setReaderLoading(true)
    setReaderError('')
    const generation = readerGeneration.current
    try {
      const file = await apiDownload(
        `/api/submissions/${item.id}/download`,
        await getIdToken(),
      )
      if (generation !== readerGeneration.current) return
      if (file.blob.type.split(';')[0].toLowerCase() !== 'application/pdf') {
        setReaderError(
          'This file cannot be read here. Please download it instead.',
        )
        return
      }
      setReaderUrl(URL.createObjectURL(file.blob))
    } catch {
      if (generation === readerGeneration.current)
        setReaderError('The paper could not be opened. Please try again.')
    } finally {
      if (generation === readerGeneration.current) setReaderLoading(false)
    }
  }

  function closeReader() {
    readerGeneration.current += 1
    setReading(null)
    setReaderLoading(false)
    setReaderUrl(null)
    setReaderError('')
  }

  const items = queueQuery.data ?? []

  return (
    <>
      <div className="space-y-8">
        <header className="flex flex-col gap-5 border-b border-[var(--border)] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow text-[var(--impact)]">
              Research and Extension Office
            </p>
            <div className="mt-3 flex items-center gap-3">
              <ClipboardCheck
                className="size-7 text-[var(--primary)]"
                aria-hidden="true"
              />
              <h1 className="display-heading text-4xl font-semibold">
                Review queue
              </h1>
            </div>
            <p className="mt-3 max-w-2xl leading-7 text-[var(--ink-muted)]">
              Make a decision on each submission. Remarks are required and
              become part of the record.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
            }
            disabled={queueQuery.isFetching}
          >
            <RefreshCw
              className={`size-4 ${queueQuery.isFetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh queue
          </Button>
        </header>

        <section
          aria-labelledby="pending-submissions-heading"
          className="space-y-4"
        >
          <div className="flex items-center justify-between gap-4">
            <h2
              id="pending-submissions-heading"
              className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]"
            >
              Pending submissions
            </h2>
            <span className="rounded-full bg-[var(--secondary)] px-3 py-1 text-sm font-semibold">
              {items.length} {items.length === 1 ? 'paper' : 'papers'}
            </span>
          </div>
          {queueQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading queue…</p>
          )}
          {queueQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              The queue could not be loaded.
            </p>
          )}
          {downloadError && (
            <p role="alert" className="text-sm text-destructive">
              {downloadError}
            </p>
          )}
          {!queueQuery.isLoading && items.length === 0 && (
            <div className="border-t-2 border-[var(--primary)] bg-white px-5 py-8">
              <FileText
                className="size-6 text-[var(--primary)]"
                aria-hidden="true"
              />
              <p className="mt-4 font-semibold">The queue is clear.</p>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                New submissions will appear here when authors send their work
                for review.
              </p>
            </div>
          )}
          {items.map((item) => (
            <article
              key={item.id}
              className="border-t-2 border-[var(--primary)] bg-white p-5 sm:p-6"
            >
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-3">
                  <h3 className="display-heading text-2xl font-semibold leading-tight">
                    {item.title}
                  </h3>
                  <div className="text-sm text-[var(--ink-muted)]">
                    {item.authors ?? 'Authors not listed'} ·{' '}
                    {item.submitterEmail ?? 'Submitter unknown'}
                  </div>
                  {item.possibleDuplicate && (
                    <div className="border border-[var(--archive-gold)] bg-[var(--secondary)] px-3 py-2 text-xs leading-5">
                      <p className="inline-flex items-center gap-2 font-semibold text-foreground">
                        <CircleAlert className="size-4" aria-hidden="true" />
                        Possible duplicate title — compare before deciding
                      </p>
                      {item.duplicateOf.length > 0 && (
                        <ul className="mt-2 space-y-1 font-normal text-foreground">
                          {item.duplicateOf.map((match) => (
                            <li key={match.id}>
                              {match.title} · {match.status} ·{' '}
                              {match.submitterEmail ?? 'submitter unknown'} ·{' '}
                              {new Date(match.createdAt).toLocaleDateString()}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {item.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {item.keywords.map((keyword) => (
                        <span
                          key={keyword}
                          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                    <FileText className="size-4" aria-hidden="true" />
                    {item.files
                      .map((f) => `${f.fileName} (${formatBytes(f.sizeBytes)})`)
                      .join(', ')}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="bg-[var(--highlight)] text-[var(--foreground)] hover:bg-[var(--highlight)]/80"
                    onClick={() => void openReader(item)}
                  >
                    <BookOpen className="size-4" aria-hidden="true" /> Read
                    paper
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void download(item)}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setDeciding(item)
                      resetDecisionFields()
                    }}
                  >
                    Review
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>

      <Dialog
        open={reading !== null}
        onOpenChange={(open) => {
          if (!open) closeReader()
        }}
      >
        <DialogContent className="flex h-[96dvh] max-h-[96dvh] w-[96vw] max-w-none flex-col sm:max-w-[96vw]">
          <DialogHeader className="pr-10">
            <DialogTitle>Read paper</DialogTitle>
            <DialogDescription className="sr-only">
              {reading?.title}
            </DialogDescription>
          </DialogHeader>
          {readerLoading && <p role="status">Opening paper…</p>}
          {readerError && (
            <p role="alert" className="text-destructive">
              {readerError}
            </p>
          )}
          {readerUrl && (
            <iframe
              title="Paper PDF viewer"
              src={readerUrl}
              className="min-h-0 w-full flex-1 border"
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              If the document does not display, download it to read it.
            </p>
            <Button variant="outline" onClick={closeReader}>
              Close reader
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open && !decideMutation.isPending) {
            setDeciding(null)
            setConfirmDecision(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {confirmDecision ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  Confirm{' '}
                  {confirmDecision === 'ACCEPTED' ? 'acceptance' : 'return'}
                </DialogTitle>
                <DialogDescription>
                  Confirm this decision for {deciding?.title}.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>Decision:</strong>{' '}
                  {confirmDecision === 'ACCEPTED' ? 'Accept' : 'Return'}
                </p>
                {confirmDecision === 'ACCEPTED' && (
                  <p>
                    <strong>Access:</strong>{' '}
                    {
                      VISIBILITY_OPTIONS.find(
                        (option) => option.value === visibility,
                      )?.label
                    }
                    {visibility !== 'PUBLIC' && embargoUntil
                      ? ` · Auto-lift ${embargoUntil}`
                      : ''}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">
                  <strong>Remarks:</strong> {remarks.trim()}
                </p>
              </div>
              {decideError && (
                <p role="alert" className="text-sm text-destructive">
                  {decideError}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={decideMutation.isPending}
                  onClick={() => setConfirmDecision(null)}
                >
                  Back
                </Button>
                <Button
                  disabled={decideMutation.isPending}
                  variant={
                    confirmDecision === 'REJECTED' ? 'destructive' : 'default'
                  }
                  onClick={() =>
                    deciding &&
                    decideMutation.mutate({
                      submissionId: deciding.id,
                      status: confirmDecision,
                      remarks: remarks.trim(),
                      ...(confirmDecision === 'ACCEPTED'
                        ? {
                            visibility,
                            ...(visibility !== 'PUBLIC' && embargoUntil
                              ? { embargoUntil }
                              : {}),
                          }
                        : {}),
                    })
                  }
                >
                  {decideMutation.isPending ? 'Saving…' : 'Confirm decision'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Decide: {deciding?.title}</DialogTitle>
                <DialogDescription>
                  Remarks are required and will be recorded with your decision.
                  {deciding && deciding.keywords.length > 0 && (
                    <> Submitted keywords: {deciding.keywords.join('; ')}.</>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="remarks">Reviewer remarks</Label>
                <Textarea
                  id="remarks"
                  className="min-h-32"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Basis for acceptance or return…"
                />
              </div>
              {/* Visibility applies to acceptance only; rejection is always
              REO-only regardless of these fields. */}
              <div className="space-y-2">
                <Label htmlFor="visibility">Access if accepted</Label>
                <Select
                  value={visibility}
                  onValueChange={(value) => {
                    setVisibility(value as 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED')
                    if (value === 'PUBLIC') setEmbargoUntil('')
                  }}
                  items={VISIBILITY_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                >
                  <SelectTrigger id="visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIBILITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {visibility !== 'PUBLIC' && (
                  <div className="space-y-1">
                    <Label htmlFor="embargo">Auto-lift date (optional)</Label>
                    <Input
                      id="embargo"
                      type="date"
                      value={embargoUntil}
                      onChange={(e) => setEmbargoUntil(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      For journals, patents, or funder agreements. On this date
                      the paper becomes public automatically. Leave blank to
                      restrict indefinitely.
                    </p>
                  </div>
                )}
              </div>
              {decideError && (
                <p role="alert" className="text-sm text-destructive">
                  {decideError}
                </p>
              )}
              <DialogFooter className="gap-2">
                <Button
                  variant="destructive"
                  disabled={
                    decideMutation.isPending || remarks.trim().length === 0
                  }
                  onClick={() => setConfirmDecision('REJECTED')}
                >
                  Return
                </Button>
                <Button
                  disabled={
                    decideMutation.isPending || remarks.trim().length === 0
                  }
                  onClick={() => setConfirmDecision('ACCEPTED')}
                >
                  Accept
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
