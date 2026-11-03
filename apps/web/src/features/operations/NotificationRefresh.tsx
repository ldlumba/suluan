import { useMutation } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'

export function NotificationRefresh() {
  const { getIdToken } = useAuth()
  const refresh = useMutation({
    mutationFn: async () =>
      apiFetch<{ queued: number; hasMore: boolean; queueFailed: boolean }>(
        '/api/repository-operations/notifications/refresh',
        await getIdToken(),
        { method: 'POST' },
      ),
  })
  return (
    <section
      aria-labelledby="notifications-heading"
      className="space-y-3 border-t-2 border-[var(--archive-gold)] bg-white p-5"
    >
      <h2 id="notifications-heading" className="text-xl font-semibold">
        Notifications
      </h2>
      <p className="text-sm text-[var(--ink-muted)]">
        Retry up to 50 waiting or failed notifications. Already completed
        notifications are not resent.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        {refresh.isPending ? 'Refreshing…' : 'Refresh notifications'}
      </Button>
      {refresh.isSuccess && (
        <p role="status" className="text-sm">
          {refresh.data.queued} notification
          {refresh.data.queued === 1 ? '' : 's'} queued for retry; delivery is
          not yet confirmed.
          {refresh.data.queueFailed
            ? ' The queue was unavailable for the rest. Please try again later.'
            : refresh.data.hasMore
              ? ' More notifications may be waiting.'
              : ''}
        </p>
      )}
      {refresh.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh notifications. Please try again later.
        </p>
      )}
    </section>
  )
}
