import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch, ApiError } from '@/lib/api'
import { SearchPage } from './SearchPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiFetch: vi.fn(),
}))

function renderPage(
  role: 'USER' | 'ADMIN' = 'ADMIN',
  entry = '/search?q=initial',
) {
  vi.mocked(useAuth).mockReturnValue({
    profile: { id: 'manager', role },
    loading: false,
    getIdToken: async () => 'test-token',
  } as never)
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[entry]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const semanticItem = {
  id: 'rec-1',
  title: 'Solar panel efficiency in humid climates',
  authors: 'Dela Cruz',
  year: '2026',
  snippet: 'Measured output under high humidity.',
  fullTextStatus: 'READY' as const,
  visibility: 'PUBLIC' as const,
}

describe('keyword search', () => {
  beforeEach(() => vi.clearAllMocks())
  it('lets ordinary UA users search but hides the manager-only prepare action', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [], page: 1, hasMore: false })
    renderPage('USER')
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', { name: /prepare extracted papers/i }),
    ).not.toBeInTheDocument()
  })
  it('uses URL queries and renders uploaded markup as plain text', async () => {
    const snippet = '<script>alert("untrusted")</script>'
    vi.mocked(apiFetch).mockResolvedValue({
      items: [
        {
          id: '1',
          title: 'Study',
          authors: null,
          year: null,
          snippet,
          fullTextStatus: 'READY',
          visibility: 'PUBLIC',
        },
      ],
      page: 1,
      hasMore: false,
    })
    renderPage()
    expect(await screen.findByText(snippet)).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
    fireEvent.change(
      screen.getByLabelText('Keywords, study title, or author'),
      { target: { value: 'solar power' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/search/records?q=solar+power&page=1',
        'test-token',
      ),
    )
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
  it('shows API permission errors instead of an empty-results success state', async () => {
    vi.mocked(apiFetch).mockRejectedValue(
      new ApiError(403, 'Permission denied.'),
    )
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Permission denied.',
    )
    expect(
      screen.queryByText(/No matching accepted papers/),
    ).not.toBeInTheDocument()
  })
  it('labels pending and failed records and suppresses their snippets', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [
        {
          id: 'pending',
          title: 'Pending study',
          year: '2026',
          authors: 'Author',
          fullTextStatus: 'PENDING',
          visibility: 'PUBLIC',
          snippet: 'Stale pending text',
        },
        {
          id: 'failed',
          title: 'Failed study',
          year: '2026',
          authors: 'Author',
          fullTextStatus: 'FAILED',
          visibility: 'PUBLIC',
          snippet: 'Stale failed text',
        },
      ],
      page: 1,
      hasMore: false,
    })
    renderPage()
    expect(
      await screen.findByText(/Full text pending — metadata only/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Full-text processing failed — metadata only/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Stale pending text')).not.toBeInTheDocument()
    expect(screen.queryByText('Stale failed text')).not.toBeInTheDocument()
  })
})

describe('semantic search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requests the semantic endpoint and renders its results in keyword mode', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/search/semantic')) {
        return {
          items: [semanticItem],
          page: 1,
          hasMore: false,
          semanticStatus: 'ready',
        } as never
      }
      return { items: [], page: 1, hasMore: false } as never
    })
    renderPage('ADMIN', '/search?q=humidity&mode=semantic')
    expect(await screen.findByText(semanticItem.title)).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/search/semantic?q=humidity&page=1',
      'test-token',
    )
    // Keyword must not also run in semantic mode.
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/api/search/records?q=humidity&page=1',
      'test-token',
    )
  })

  it('falls back to keyword results when the daily limit is reached', async () => {
    const keywordItem = {
      ...semanticItem,
      id: 'kw-1',
      title: 'Keyword fallback study',
    }
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/search/semantic')) {
        return {
          items: [],
          page: 1,
          hasMore: false,
          semanticStatus: 'quota_exhausted',
          reason: 'daily embedding limit reached',
        } as never
      }
      return { items: [keywordItem], page: 1, hasMore: false } as never
    })
    renderPage('ADMIN', '/search?q=humidity&mode=semantic')
    // The user still gets results, plus an explanation of the downgrade.
    expect(await screen.findByText(keywordItem.title)).toBeInTheDocument()
    expect(screen.getByText(/daily limit is reached/i)).toBeInTheDocument()
  })

  it('explains that semantic search is unconfigured without an error', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/search/semantic')) {
        return {
          items: [],
          page: 1,
          hasMore: false,
          semanticStatus: 'unconfigured',
        } as never
      }
      return { items: [], page: 1, hasMore: false } as never
    })
    renderPage('USER', '/search?q=humidity&mode=semantic')
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers embedding only to managers', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [], page: 1, hasMore: false })
    renderPage('USER', '/search?q=humidity&mode=semantic')
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', { name: /embed papers for semantic search/i }),
    ).not.toBeInTheDocument()

    vi.clearAllMocks()
    renderPage('ADMIN', '/search?q=humidity&mode=semantic')
    expect(
      await screen.findByRole('button', { name: /embed papers for semantic search/i }),
    ).toBeInTheDocument()
  })
})
