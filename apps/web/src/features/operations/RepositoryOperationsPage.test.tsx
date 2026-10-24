import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { RepositoryOperationsPage } from './RepositoryOperationsPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
}))

const status = {
  pipeline: {
    queuedExtraction: 2,
    processingExtraction: 0,
    failedExtraction: 0,
    unindexedRecords: 1,
    missingEmbeddingRecords: 1,
    missingEmbeddingChunks: 12,
  },
  embeddingQuota: {
    requestsUsed: 3,
    requestsLimit: 20,
    inputsUsed: 42,
    inputsLimit: 2000,
  },
  dispatcherConfigured: true,
  recentRuns: [],
}

function renderPage(role: 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN') {
  vi.mocked(useAuth).mockReturnValue({
    user: { email: 'manager@ua.edu.ph' },
    profile: { id: 'manager-1', role },
    loading: false,
    getIdToken: async () => 'token',
  } as never)
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RepositoryOperationsPage />
    </QueryClientProvider>,
  )
}

describe('repository operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiFetch).mockResolvedValue(status as never)
  })

  it('denies ordinary users without loading operational data', () => {
    renderPage('USER')
    expect(screen.getByText(/only repository managers/i)).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('allows a repository manager to start extraction', async () => {
    renderPage('REPOSITORY_MANAGER')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Run extraction' }),
    )
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/repository-operations/extraction',
        'token',
        { method: 'POST' },
      ),
    )
  })

  it('requires confirmation before semantic embedding', async () => {
    renderPage('ADMIN')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Run semantic embedding' }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/api/repository-operations/embedding',
      expect.anything(),
      expect.anything(),
    )
  })
})
