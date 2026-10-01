import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
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

interface QueueItem {
  id: string
  title: string
  authors: string | null
  year: string | null
  researchType: string | null
  createdAt: string
  submitterEmail: string | null
  files: { fileName: string; mimeType: string | null; sizeBytes: number | null }[]
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
  const [decideError, setDecideError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  // Visibility defaults to PUBLIC so accepting never silently hides a paper.
  const [visibility, setVisibility] = useState<'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'>(
    'PUBLIC',
  )
  const [embargoUntil, setEmbargoUntil] = useState('')

  const VISIBILITY_OPTIONS = [
    { value: 'PUBLIC', label: 'Public — anyone can read and download' },
    { value: 'UA_ONLY', label: 'University access — UA sign-in required' },
    { value: 'RESTRICTED', label: 'Restricted — repository managers only' },
  ] as const

  function resetDecisionFields() {
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
        err instanceof ApiError ? err.message : 'The decision could not be recorded.',
      )
    },
  })

  if (loading) return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
  if (!user) return <p className="text-sm text-muted-foreground">Sign in to continue.</p>
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
          Your permissions could not be loaded. Please sign out and sign in again.
        </CardContent>
      </Card>
    )
  }

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

  const items = queueQuery.data ?? []

  return (
    <>
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <CardDescription>
            Pending submissions. Remarks are required before accepting or rejecting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <p className="text-sm text-muted-foreground">No pending submissions.</p>
          )}
          {items.map((item) => (
            <div key={item.id} className="space-y-2 rounded-lg border p-4">
              <div className="font-medium">{item.title}</div>
              <div className="text-sm text-muted-foreground">
                {item.authors ?? 'Authors not listed'} · {item.year ?? 'Year not listed'}
                {' · '}
                {item.submitterEmail ?? 'Submitter unknown'}
              </div>
              <div className="text-sm text-muted-foreground">
                {item.files.map((f) => `${f.fileName} (${formatBytes(f.sizeBytes)})`).join(', ')}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void download(item)}>
                  Download paper
                </Button>
                <Button size="sm" onClick={() => {
                  setDeciding(item)
                  resetDecisionFields()
                }}>
                  Review
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={deciding !== null} onOpenChange={(open) => { if (!open) setDeciding(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decide: {deciding?.title}</DialogTitle>
            <DialogDescription>
              Remarks are required and will be recorded with your decision.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="remarks">Reviewer remarks</Label>
            <Textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Basis for acceptance or rejection…"
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
              items={VISIBILITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
                  For journals, patents, or funder agreements. On this date the
                  paper becomes public automatically. Leave blank to restrict
                  indefinitely.
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
              disabled={decideMutation.isPending || remarks.trim().length === 0}
              onClick={() =>
                deciding &&
                decideMutation.mutate({
                  submissionId: deciding.id,
                  status: 'REJECTED',
                  remarks: remarks.trim(),
                })
              }
            >
              Reject
            </Button>
            <Button
              disabled={decideMutation.isPending || remarks.trim().length === 0}
              onClick={() =>
                deciding &&
                decideMutation.mutate({
                  submissionId: deciding.id,
                  status: 'ACCEPTED',
                  remarks: remarks.trim(),
                  visibility,
                  ...(visibility !== 'PUBLIC' && embargoUntil
                    ? { embargoUntil }
                    : {}),
                })
              }
            >
              Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
