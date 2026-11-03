import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import { ReviewQueuePage } from './ReviewQueuePage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))

const mockedUseAuth = vi.mocked(useAuth)

function renderPage(role: 'USER' | 'REPOSITORY_MANAGER' | null) {
  mockedUseAuth.mockReturnValue({
    user: { email: 'u@ua.edu.ph' },
    profile: role === null ? null : { id: 'p1', email: 'u@ua.edu.ph', role },
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    getIdToken: vi.fn(),
  } as never)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ReviewQueuePage />
    </QueryClientProvider>,
  )
}

describe('ReviewQueuePage access display', () => {
  it('tells ordinary users the page is managers-only', () => {
    renderPage('USER')
    expect(screen.getByText(/only repository managers/i)).toBeInTheDocument()
  })

  it('shows the queue shell for managers', () => {
    renderPage('REPOSITORY_MANAGER')
    expect(
      screen.getByRole('heading', { name: 'Review queue' }),
    ).toBeInTheDocument()
  })

  it('asks for re-sign-in when permissions fail to load', () => {
    renderPage(null)
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
  })
  it.each(['Accept', 'Return'])(
    'confirms %s before posting',
    async (decision) => {
      const fetchMock = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) =>
          init?.method === 'POST'
            ? new Response(JSON.stringify({ id: '1', status: 'ACCEPTED' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            : new Response(
                JSON.stringify([
                  {
                    id: '1',
                    title: 'Test paper',
                    authors: null,
                    submitterEmail: null,
                    keywords: [],
                    files: [],
                    possibleDuplicate: false,
                    duplicateOf: [],
                  },
                ]),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
      )
      vi.stubGlobal('fetch', fetchMock)
      renderPage('REPOSITORY_MANAGER')
      fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
      fireEvent.change(screen.getByLabelText('Reviewer remarks'), {
        target: { value: 'Reviewed carefully' },
      })
      fireEvent.click(screen.getByRole('button', { name: decision }))
      expect(screen.getByText(/Reviewed carefully/)).toBeInTheDocument()
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
      ).toHaveLength(0)
      fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }))
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST'),
        ).toHaveLength(1),
      )
      vi.unstubAllGlobals()
    },
  )
})
