import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { HomePage } from './HomePage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

function renderPage() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('repository home page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      profile: null,
      loading: false,
      getIdToken: async () => null,
    } as never)
  })

  it('shows the six newest visibility-filtered papers', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: Array.from({ length: 7 }, (_, index) => ({
        id: `paper-${index + 1}`,
        title: `Recently accepted paper ${index + 1}`,
        authors: `Author ${index + 1}`,
        schoolName: 'School of Technological Studies',
        courseName: 'BS Information Technology',
      })),
    })
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Newly accepted research.' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/search/records?q=&page=1&sort=newest',
        null,
      ),
    )
    expect(
      screen.getByRole('link', { name: 'Recently accepted paper 1' }),
    ).toHaveAttribute('href', '/records/paper-1')
    expect(screen.getByText('Author 1')).toBeInTheDocument()
    expect(
      screen.getAllByText(
        'School of Technological Studies · BS Information Technology',
      ),
    ).toHaveLength(6)
    expect(
      screen.queryByText('Recently accepted paper 7'),
    ).not.toBeInTheDocument()
  })

  it('keeps the homepage usable when recent papers cannot load', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('offline'))
    renderPage()

    expect(
      await screen.findByText(/temporarily unavailable/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Explore the repository/i }),
    ).toBeInTheDocument()
  })
})
