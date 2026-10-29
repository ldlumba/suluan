import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { AdminUsersPage } from './AdminUsersPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
}))

describe('account role administration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'admin@ua.edu.ph' },
      profile: { id: 'admin-1', role: 'ADMIN' },
      loading: false,
      getIdToken: async () => 'token',
    } as never)
    vi.mocked(apiFetch).mockResolvedValue([])
  })

  it('lists the implemented permissions exclusive to administrators', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AdminUsersPage />
      </QueryClientProvider>,
    )

    expect(
      screen.getByRole('heading', { name: 'Administrator-only permissions' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/assign User, Repository manager, or Administrator/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/activate or deactivate courses/i),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No admitted accounts have signed in yet.'),
    ).toBeInTheDocument()
  })

  it('filters accounts by email without changing their roles', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      {
        id: '1',
        email: 'alice@ua.edu.ph',
        displayName: null,
        role: 'USER',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: '2',
        email: 'bob@ua.edu.ph',
        displayName: null,
        role: 'USER',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ])
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminUsersPage />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('alice@ua.edu.ph')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search by email'), {
      target: { value: 'BOB@' },
    })
    expect(screen.queryByText('alice@ua.edu.ph')).not.toBeInTheDocument()
    expect(screen.getByText('bob@ua.edu.ph')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search by email'), {
      target: { value: 'missing' },
    })
    expect(
      screen.getByText('No accounts match this email.'),
    ).toBeInTheDocument()
  })
})
