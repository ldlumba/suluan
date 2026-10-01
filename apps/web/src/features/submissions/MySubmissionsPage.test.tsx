import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch, ApiError } from '@/lib/api'
import { MySubmissionsPage } from './MySubmissionsPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFetch: vi.fn(),
}))

function renderPage(user: unknown) {
  vi.mocked(useAuth).mockReturnValue({
    user,
    profile: null,
    loading: false,
    getIdToken: async () => 'test-token',
  } as never)
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/submissions']}>
        <MySubmissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const decided = {
  id: 'sub-1',
  title: 'ILAW - Test Paper',
  authors: 'Author',
  year: '2026',
  researchType: 'Thesis',
  status: 'ACCEPTED' as const,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  remarks: 'Solid methodology, publish it.',
  decidedAt: '2026-10-01T00:00:00.000Z',
  recordId: 'rec-1',
  visibility: 'UA_ONLY',
  embargoUntil: '2027-01-01',
  effectiveVisibility: 'UA_ONLY',
}

describe('MySubmissionsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prompts signed-out visitors to sign in without fetching', () => {
    renderPage(null)
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('shows the submitter status, remarks, and embargo from the API', async () => {
    vi.mocked(apiFetch).mockResolvedValue([decided])
    renderPage({ email: 'u@ua.edu.ph' })
    expect(await screen.findByText('ILAW - Test Paper')).toBeInTheDocument()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.getByText(/Solid methodology/)).toBeInTheDocument()
    expect(screen.getByText(/access restrictions until 2027-01-01/)).toBeInTheDocument()
  })

  it('renders a pending submission with no remarks', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { ...decided, status: 'PENDING', remarks: null, recordId: null },
    ])
    renderPage({ email: 'u@ua.edu.ph' })
    expect(await screen.findByText('Awaiting REO review')).toBeInTheDocument()
    expect(screen.queryByText(/Reviewer remarks/)).not.toBeInTheDocument()
  })

  it('surfaces API errors instead of an empty success state', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new ApiError(401, 'Session expired.'))
    renderPage({ email: 'u@ua.edu.ph' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Session expired.')
  })
})
