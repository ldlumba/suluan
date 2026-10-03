import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { NewSubmissionPage } from './NewSubmissionPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))

const mockedUseAuth = vi.mocked(useAuth)

const catalog = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'School of Health, Arts and Sciences',
    courses: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'BS Nursing',
      },
    ],
  },
]

function renderPage() {
  mockedUseAuth.mockReturnValue({
    user: { email: 'student@ua.edu.ph' },
    profile: { id: 'p1', email: 'student@ua.edu.ph', role: 'USER' },
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    getIdToken: vi.fn().mockResolvedValue('token'),
  } as never)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <NewSubmissionPage />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('NewSubmissionPage catalog UX', () => {
  it('shows the compact catalog helper and derives year at acceptance', async () => {
    renderPage()

    expect(screen.queryByLabelText('Research type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument()
    expect(
      screen.getByText(/year is assigned automatically/i),
    ).toBeInTheDocument()

    const nursing = await screen.findByRole('button', { name: 'BS Nursing' })
    expect(nursing).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(nursing)
    expect(nursing).toHaveAttribute('aria-pressed', 'true')
  })
})
