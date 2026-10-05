import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { GraphPage } from './GraphPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFetch: vi.fn(),
}))

function renderPage(
  entry = '/graph?record=11111111-1111-4111-8111-111111111111',
) {
  vi.mocked(useAuth).mockReturnValue({
    getIdToken: async () => 'test-token',
  } as never)
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[entry]}>
        <GraphPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('knowledge graph discovery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads a viewer-aware paper neighborhood and provides a text paper list', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      centerId: '11111111-1111-4111-8111-111111111111',
      depth: 2,
      truncated: false,
      nodes: [
        {
          id: 'paper:11111111-1111-4111-8111-111111111111',
          type: 'paper',
          label: 'Center paper',
          recordId: '11111111-1111-4111-8111-111111111111',
          center: true,
        },
        {
          id: 'paper:22222222-2222-4222-8222-222222222222',
          type: 'paper',
          label: 'Related paper',
          recordId: '22222222-2222-4222-8222-222222222222',
        },
      ],
      edges: [],
    } as never)
    renderPage()

    expect((await screen.findAllByText('Center paper')).length).toBeGreaterThan(
      0,
    )
    expect(screen.getByRole('link', { name: 'Related paper' })).toHaveAttribute(
      'href',
      '/graph?record=22222222-2222-4222-8222-222222222222',
    )
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/graph/neighborhood?type=paper&id=11111111-1111-4111-8111-111111111111&depth=2',
        'test-token',
      ),
    )
  })

  it('explains how to choose a paper when no center is supplied', () => {
    renderPage('/graph')
    expect(screen.getByText(/Choose/)).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
