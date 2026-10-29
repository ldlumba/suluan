import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { ManagerDashboardPage } from './ManagerDashboardPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
}))

describe('manager dashboard', () => {
  it('provides manager tools and no administrator-only controls', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { id: 'm1', role: 'REPOSITORY_MANAGER' },
      getIdToken: async () => 'token',
    } as never)
    vi.mocked(apiFetch).mockResolvedValue({
      pipeline: {
        queuedExtraction: 2,
        processingExtraction: 1,
        failedExtraction: 0,
        unindexedRecords: 0,
      },
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ManagerDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      screen.getByRole('link', { name: /Review submissions/ }),
    ).toHaveAttribute('href', '/review')
    expect(
      screen.getByRole('link', { name: /Prepare papers for search/ }),
    ).toHaveAttribute('href', '/operations')
    expect(
      screen.getByRole('link', { name: /Explore research trends/ }),
    ).toHaveAttribute('href', '/graph/analytics')
    expect(
      screen.queryByRole('link', { name: /Account roles|Course availability/ }),
    ).not.toBeInTheDocument()
    expect(await screen.findByText('2')).toBeInTheDocument()
  })
})
