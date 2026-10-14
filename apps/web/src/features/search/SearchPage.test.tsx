import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch, ApiError } from '@/lib/api'
import { SearchPage } from './SearchPage'
import { SemanticAccessPage } from './SemanticAccessPage'

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
  schoolName: 'School of Technological Studies',
  courseName: 'BS Information Technology',
  year: '2026',
  keywords: [] as string[],
  snippet: 'Measured output under high humidity.',
  fullTextStatus: 'READY' as const,
  visibility: 'PUBLIC' as const,
}

describe('keyword search', () => {
  beforeEach(() => vi.clearAllMocks())
  it('sends title scope and keeps title mode when submitting', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [],
      page: 1,
      hasMore: false,
    })
    renderPage('USER', '/search?q=farmer&mode=title')
    expect(
      screen.getByRole('heading', { name: 'Title search' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('scope=title'),
        'test-token',
      ),
    )
    fireEvent.change(screen.getByLabelText('Words in the paper title'), {
      target: { value: 'solar' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringMatching(/q=solar.*scope=title/),
        'test-token',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Keyword' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith(
        '/api/search/records?q=solar&page=1&sort=relevance',
        'test-token',
      ),
    )
  })
  it('does not expose the retired manual indexing action', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [],
      page: 1,
      hasMore: false,
    })
    renderPage('ADMIN')
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
          keywords: [],
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
        '/api/search/records?q=solar+power&page=1&sort=relevance',
        'test-token',
      ),
    )
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
  it('clears the query into newest-first browse mode', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [],
      page: 1,
      hasMore: false,
    })
    renderPage('USER', '/search?q=solar+power')
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/search/records?q=&page=1&sort=newest',
        'test-token',
      ),
    )
    expect(
      screen.getByLabelText('Keywords, study title, or author'),
    ).toHaveValue('')
  })
  it('shows school and course beneath authors and year', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [semanticItem],
      page: 1,
      hasMore: false,
    })
    renderPage('USER')
    expect(
      await screen.findByText(
        'School of Technological Studies · BS Information Technology',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /View relationships/i }),
    ).toHaveAttribute('href', '/graph?record=rec-1')
  })
  it('renders author keywords and applies the exact-match filter', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [{ ...semanticItem, keywords: ['Machine Learning', 'Vision'] }],
      page: 1,
      hasMore: false,
    })
    renderPage('USER')
    expect(
      await screen.findByText('Keywords: Machine Learning; Vision'),
    ).toBeInTheDocument()
    fireEvent.change(
      screen.getByLabelText('Filter by author keyword (exact match)'),
      { target: { value: 'machine learning' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('keyword=machine+learning'),
        'test-token',
      ),
    )
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
          keywords: [],
          fullTextStatus: 'PENDING',
          visibility: 'PUBLIC',
          snippet: 'Stale pending text',
        },
        {
          id: 'failed',
          title: 'Failed study',
          year: '2026',
          authors: 'Author',
          keywords: [],
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

  it('requests the semantic endpoint and renders its results in semantic mode', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/search/semantic')) {
        return {
          items: [semanticItem],
          page: 1,
          hasMore: false,
          semanticStatus: 'ready',
          retrievalMode: 'hybrid',
        } as never
      }
      return { items: [], page: 1, hasMore: false } as never
    })
    renderPage('ADMIN', '/search?q=humidity&mode=semantic')
    expect(await screen.findByText(semanticItem.title)).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Semantic search' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/meaning and exact terms together/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/not enabled yet/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Related by meaning' }),
    ).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/search/semantic?q=humidity&page=1',
      'test-token',
    )
    // Keyword must not also run in semantic mode.
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/api/search/records?q=humidity&page=1',
      'test-token',
    )
    expect(screen.queryByText('Full text searchable')).not.toBeInTheDocument()
  })

  it('explains when neither semantic nor keyword retrieval finds a match', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [],
      page: 1,
      hasMore: false,
      semanticStatus: 'ready',
    } as never)
    renderPage('ADMIN', '/search?q=maritime+law&mode=semantic')

    expect(
      await screen.findByText(/No meaning-based or keyword matches/),
    ).toHaveTextContent('Try another description')
    expect(
      screen.queryByText(/No matching accepted papers/),
    ).not.toBeInTheDocument()
  })

  it('labels exploratory semantic and keyword-only results separately', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [
        { ...semanticItem, id: 'broad', matchType: 'exploratory' },
        {
          ...semanticItem,
          id: 'keyword',
          title: 'Exact farmer keyword study',
          matchType: 'keyword',
        },
      ],
      page: 1,
      hasMore: false,
      semanticStatus: 'ready',
      retrievalMode: 'hybrid',
    } as never)
    renderPage('ADMIN', '/search?q=farmers&mode=semantic')

    expect(
      await screen.findByRole('heading', { name: 'Possibly related papers' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Keyword matches' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Broader meaning match')).toBeInTheDocument()
    expect(screen.getByText('Keyword match')).toBeInTheDocument()
  })

  it('explains lexical fallback without presenting it as semantic evidence', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [
        {
          ...semanticItem,
          id: 'keyword-fallback',
          title: 'Farmers livelihood study',
          matchType: 'keyword',
        },
      ],
      page: 1,
      hasMore: false,
      semanticStatus: 'ready',
      retrievalMode: 'keyword_fallback',
    } as never)
    renderPage('ADMIN', '/search?q=farmers&mode=semantic')

    expect(
      await screen.findByText(/No confident meaning-based matches/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Keyword matches' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Meaning match')).not.toBeInTheDocument()
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
    expect(
      screen.getByRole('heading', { name: 'Semantic search' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not expose manual embedding controls', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      items: [],
      page: 1,
      hasMore: false,
    })
    renderPage('USER', '/search?q=humidity&mode=semantic')
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', {
        name: /embed papers for semantic search/i,
      }),
    ).not.toBeInTheDocument()

    expect(
      screen.queryByRole('button', {
        name: /embed papers for semantic search/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('does not call the semantic API for public visitors', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: null,
      loading: false,
      getIdToken: async () => null,
    } as never)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/search?q=humidity&mode=semantic']}>
          <Routes>
            <Route path="/search" element={<SearchPage />} />
            <Route
              path="/search/semantic-access"
              element={<SemanticAccessPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Sign in to use semantic search',
      }),
    ).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
