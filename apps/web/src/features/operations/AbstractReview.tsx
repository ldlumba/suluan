import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'

interface Details {
  abstract: string | null
  candidate: string | null
  approved: boolean
  updatedAt: string
  processingStatus: string | null
}

export function AbstractReview({
  paper,
  onClose,
}: {
  paper: { id: string; title: string }
  onClose: () => void
}) {
  const { getIdToken } = useAuth()
  const query = useQuery({
    queryKey: ['record-abstract-review', paper.id],
    retry: false,
    staleTime: 0,
    queryFn: async () =>
      apiFetch<Details>(
        `/api/record-access/${paper.id}/abstract`,
        await getIdToken(),
      ),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review abstract</DialogTitle>
          <DialogDescription>{paper.title}</DialogDescription>
        </DialogHeader>
        {query.isLoading && <p role="status">Loading abstract…</p>}
        {query.isError && (
          <p role="alert">Could not load the abstract. Close and try again.</p>
        )}
        {query.data && !query.isFetching && (
          <AbstractForm paper={paper} details={query.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AbstractForm({
  paper,
  details,
  onClose,
}: {
  paper: { id: string }
  details: Details
  onClose: () => void
}) {
  const { getIdToken } = useAuth()
  const client = useQueryClient()
  const [value, setValue] = useState(
    details.approved
      ? (details.abstract ?? '')
      : (details.candidate ?? details.abstract ?? ''),
  )
  const save = useMutation({
    mutationFn: async () =>
      apiFetch(`/api/record-access/${paper.id}/abstract`, await getIdToken(), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          abstract: value.trim(),
          expectedUpdatedAt: details.updatedAt,
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['record-access'] })
      void client.invalidateQueries({ queryKey: ['paper', paper.id] })
      void client.invalidateQueries({
        queryKey: ['record-abstract-review', paper.id],
      })
      onClose()
    },
  })
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {details.approved
          ? 'This abstract is visible to people who can access the paper. Review changes before saving.'
          : details.candidate
            ? 'This text was found automatically. Check it against the paper and correct it before approving.'
            : details.processingStatus === 'QUEUED' ||
                details.processingStatus === 'PROCESSING'
              ? 'The paper is still being processed. You may enter an abstract yourself.'
              : 'No abstract was found automatically. You may enter one yourself.'}
      </p>
      <Label htmlFor="review-abstract">Abstract</Label>
      <Textarea
        id="review-abstract"
        rows={10}
        maxLength={10000}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {save.isError && (
        <p role="alert">
          Could not save the abstract. The paper may have changed; close this
          window and try again.
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" disabled={save.isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!value.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Approve and save'}
        </Button>
      </DialogFooter>
    </>
  )
}
