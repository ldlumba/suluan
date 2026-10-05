import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { GraphAnalyticsPage } from './GraphAnalyticsPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFetch: vi.fn(),
}))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  BarChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="aggregate-chart">{children}</div>
  ),
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

function renderPage(entry = '/graph/analytics') {
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
        <GraphAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('graph aggregate analytics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows bounded viewer-specific keyword counts and co-occurrences', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      groupBy: 'keyword',
      totalPapers: 36,
      items: [
        { id: 'keyword-1', label: 'Machine Learning', count: 5 },
        { id: 'keyword-2', label: 'Agriculture', count: 3 },
      ],
      pairs: [
        {
          firstId: 'keyword-1',
          firstLabel: 'Machine Learning',
          secondId: 'keyword-2',
          secondLabel: 'Agriculture',
          count: 2,
        },
      ],
      hasMore: false,
      pairsHaveMore: false,
      limit: 20,
    } as never)
    renderPage()

    expect(
      await screen.findByText(/36 visible accepted papers/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Machine Learning' }),
    ).toHaveAttribute('href', '/search?keyword=Machine%20Learning')
    expect(
      screen.getByText(/Machine Learning \+ Agriculture/),
    ).toHaveTextContent('2 papers')
    expect(screen.getByTestId('aggregate-chart')).toBeInTheDocument()
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/graph/counts?groupBy=keyword',
        'test-token',
      ),
    )
  })

  it('uses the URL-selected grouping', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      groupBy: 'year',
      totalPapers: 4,
      items: [{ id: '2026', label: '2026', count: 4 }],
      pairs: [],
      hasMore: false,
      pairsHaveMore: false,
      limit: 20,
    } as never)
    renderPage('/graph/analytics?groupBy=year')

    expect(await screen.findByRole('link', { name: '2026' })).toHaveAttribute(
      'href',
      '/search?q=2026',
    )
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/graph/counts?groupBy=year',
      'test-token',
    )
  })
})
