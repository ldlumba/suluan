import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('scrolls to the top when opening search from the bottom call to action', () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [] })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderPage()
    fireEvent.click(screen.getByRole('link', { name: 'Search SULUAN' }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    scrollTo.mockRestore()
  })

  it('shows the six newest visibility-filtered papers', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path === '/api/search/program-highlights'
        ? { items: [] }
        : {
            items: Array.from({ length: 7 }, (_, index) => ({
              id: `paper-${index + 1}`,
              title: `Recently accepted paper ${index + 1}`,
              authors: `Author ${index + 1}`,
              schoolName: 'School of Technological Studies',
              courseName: 'BS Information Technology',
            })),
          },
    )
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
      await screen.findByText(
        'Newly accepted papers are temporarily unavailable.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Explore the repository/i }),
    ).toBeInTheDocument()
  })

  it('shows recent papers from different programs without requiring a selection', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/search/program-highlights')
        return {
          items: [
            {
              id: 'chosen',
              title: 'Program paper',
              authors: null,
              courseId: 'program',
              courseName: 'Program',
              schoolName: 'School',
              year: '2026',
            },
            {
              id: 'other',
              title: 'Another program paper',
              authors: null,
              courseId: 'other',
              courseName: 'Other program',
              schoolName: 'School',
              year: '2026',
            },
          ],
        }
      return { items: [] }
    })
    renderPage()
    expect(
      await screen.findByRole('link', { name: 'Program paper' }),
    ).toHaveAttribute('href', '/records/chosen')
    expect(apiFetch).toHaveBeenCalledWith(
      '/api/search/program-highlights',
      null,
    )
    expect(
      screen.getAllByRole('link', { name: 'More from this program' })[0],
    ).toHaveAttribute('href', '/search?sort=newest&courseId=program')
    expect(
      screen.getByRole('link', { name: 'Another program paper' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Explore all papers' }),
    ).toHaveAttribute('href', '/search')
    const newest = screen.getByRole('heading', {
      name: 'Newly accepted research.',
    })
    const programs = screen.getByRole('heading', { name: 'Browse by program.' })
    const closing = screen.getByRole('heading', {
      name: 'The collection is ready when you are.',
    })
    expect(
      newest.compareDocumentPosition(programs) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      programs.compareDocumentPosition(closing) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const rail = screen.getByRole('list', {
      name: 'Recently accepted papers by program',
    })
    expect(rail).toHaveAttribute('tabindex', '0')
    expect(rail.className).toContain('[scrollbar-width:none]')
    expect(rail.className).toContain('motion-safe:scroll-smooth')
    expect(rail.className).toContain('motion-reduce:scroll-auto')
    expect(
      rail.compareDocumentPosition(
        screen.getByRole('button', { name: 'Next program papers' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const scrollBy = vi.fn()
    Object.defineProperty(rail, 'scrollBy', { value: scrollBy })
    fireEvent.click(screen.getByRole('button', { name: 'Next program papers' }))
    expect(scrollBy).toHaveBeenCalledWith({ left: 320, behavior: 'auto' })
  })
})
