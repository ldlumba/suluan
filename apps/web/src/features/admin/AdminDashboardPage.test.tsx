import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { AdminDashboardPage } from './AdminDashboardPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFetch: vi.fn(),
}))

describe('AdminDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'admin@ua.edu.ph' },
      profile: { id: 'admin-1', email: 'admin@ua.edu.ph', role: 'ADMIN' },
      loading: false,
      getIdToken: async () => 'token',
    } as never)
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path === '/api/admin/users') return []
      if (path === '/api/admin/activity') {
        return {
          paperViews: 0,
          citationCopies: 0,
          downloadStarts: 0,
          viewers: 0,
          viewedPapers: 0,
        }
      }
      return {
        pipeline: {
          queuedExtraction: 0,
          processingExtraction: 0,
          failedExtraction: 0,
          unindexedRecords: 0,
          missingEmbeddingRecords: 0,
          missingEmbeddingChunks: 0,
        },
        embeddingQuota: {
          requestsUsed: 0,
          requestsLimit: 20,
          inputsUsed: 0,
          inputsLimit: 2000,
        },
        dispatcherConfigured: true,
      }
    })
  })

  it('is the central entry point for privileged workspaces', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AdminDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('link', { name: /Review queue/ })).toHaveAttribute(
      'href',
      '/review',
    )
    expect(
      screen.getByRole('link', { name: /Repository operations/ }),
    ).toHaveAttribute('href', '/operations')
    expect(
      screen.getByRole('link', { name: /Repository analytics/ }),
    ).toHaveAttribute('href', '/graph/analytics')
    expect(screen.getByRole('link', { name: /Account roles/ })).toHaveAttribute(
      'href',
      '/admin/users',
    )
    expect(
      screen.getByRole('link', { name: /Course availability/ }),
    ).toHaveAttribute('href', '/admin/catalog')
  })
})
