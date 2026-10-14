import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ShieldCheck, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

type Role = 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN'

interface UserRow {
  id: string
  email: string | null
  displayName: string | null
  role: Role
  createdAt: string
  updatedAt: string
}

const roles: { value: Role; label: string }[] = [
  { value: 'USER', label: 'User' },
  { value: 'REPOSITORY_MANAGER', label: 'Repository manager' },
  { value: 'ADMIN', label: 'Administrator' },
]

function RoleEditor({ account }: { account: UserRow }) {
  const { getIdToken } = useAuth()
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role>(account.role)
  const update = useMutation({
    mutationFn: async () =>
      apiFetch<UserRow>(
        `/api/admin/users/${encodeURIComponent(account.id)}/role`,
        await getIdToken(),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role,
            expectedUpdatedAt: account.updatedAt,
          }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
      <Select
        items={roles}
        value={role}
        onValueChange={(value) => value && setRole(value as Role)}
        disabled={update.isPending}
      >
        <SelectTrigger aria-label={`Role for ${account.email ?? 'account'}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        className="sm:w-24"
        disabled={update.isPending || role === account.role}
        onClick={() => update.mutate()}
      >
        {update.isPending ? 'Saving…' : 'Save role'}
      </Button>
      {update.isError && (
        <p role="alert" className="text-sm text-destructive sm:basis-full">
          {update.error instanceof ApiError
            ? update.error.message
            : 'The role could not be changed.'}
        </p>
      )}
    </div>
  )
}

export function AdminUsersPage() {
  const { user, profile, loading, getIdToken } = useAuth()
  const accounts = useQuery({
    queryKey: ['admin-users', profile?.id],
    enabled: profile?.role === 'ADMIN',
    retry: false,
    queryFn: async () =>
      apiFetch<UserRow[]>('/api/admin/users', await getIdToken()),
  })

  if (loading) return <p role="status">Checking access…</p>
  if (!user) return <p>Sign in to manage account roles.</p>
  if (profile?.role !== 'ADMIN')
    return <p>Only administrators can manage account roles.</p>

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <UserCog
              className="size-7 text-[var(--primary)]"
              aria-hidden="true"
            />
            <h1 className="display-heading text-4xl font-semibold">
              Account roles
            </h1>
          </div>
          <p className="mt-3 max-w-2xl leading-7 text-[var(--ink-muted)]">
            Grant repository review or administration access only to verified UA
            accounts. Every change is audited, and the final administrator
            cannot be removed.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={accounts.isFetching}
          onClick={() => void accounts.refetch()}
        >
          <RefreshCw
            className={`size-4 ${accounts.isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </header>

      <div className="flex items-start gap-3 rounded-[8px] border border-border bg-white p-4 text-sm leading-6 text-[var(--ink-muted)]">
        <ShieldCheck
          className="mt-0.5 size-5 shrink-0 text-[var(--primary)]"
          aria-hidden="true"
        />
        <p>
          Repository managers can review submissions and operate repository
          workflows. Administrators can additionally manage roles and course
          availability.
        </p>
      </div>

      {accounts.isPending && <p role="status">Loading accounts…</p>}
      {accounts.isError && (
        <p role="alert" className="text-destructive">
          The account list could not be loaded.
        </p>
      )}
      {accounts.isSuccess && accounts.data.length === 0 && (
        <p>No verified UA accounts have signed in yet.</p>
      )}

      {accounts.isSuccess && accounts.data.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {accounts.data.map((account) => (
            <li
              key={`${account.id}:${account.updatedAt}`}
              className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,auto)] lg:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {account.displayName || account.email || 'Unnamed account'}
                </p>
                {account.displayName && account.email && (
                  <p className="mt-1 truncate text-sm text-[var(--ink-muted)]">
                    {account.email}
                  </p>
                )}
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Added {new Date(account.createdAt).toLocaleDateString()}
                </p>
              </div>
              <RoleEditor account={account} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
