import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
