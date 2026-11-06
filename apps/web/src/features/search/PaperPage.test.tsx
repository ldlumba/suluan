import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiDownload, apiFetch } from '@/lib/api'
import { PaperPage } from './PaperPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
}))

describe('paper page', () => {
  it('closes the reader while a download is pending without opening it later', async () => {
    vi.mocked(apiDownload).mockClear()
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      getIdToken: async () => null,
    } as never)
    vi.mocked(apiFetch).mockResolvedValue({
      id: 'paper',
      title: 'Paper',
      authors: null,
      authorList: [],
      publication: null,
      schoolName: null,
      courseName: null,
      year: null,
      visibility: 'PUBLIC',
      fullTextStatus: 'READY',
      keywords: [],
    })
    let resolve!: (file: { blob: Blob; fileName: string }) => void
    vi.mocked(apiDownload).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const create = vi.spyOn(URL, 'createObjectURL')
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/records/paper']}>
          <Routes>
            <Route path="/records/:id" element={<PaperPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Read paper' }))
    await waitFor(() => expect(apiDownload).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Close reader' }))
    resolve({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      fileName: 'paper.pdf',
    })
    await waitFor(() =>
      expect(screen.queryByTitle('Paper PDF viewer')).not.toBeInTheDocument(),
    )
    expect(create).not.toHaveBeenCalled()
    create.mockRestore()
  })
  it('opens authorized PDF bytes in the reader and releases them on close', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      getIdToken: async () => null,
    } as never)
    vi.mocked(apiFetch).mockResolvedValue({
      id: 'paper',
      title: 'Paper',
      authors: null,
      authorList: [],
      publication: null,
      schoolName: null,
      courseName: null,
      year: null,
      visibility: 'PUBLIC',
      fullTextStatus: 'READY',
      keywords: [],
    })
    vi.mocked(apiDownload).mockResolvedValue({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      fileName: 'paper.pdf',
    })
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:paper')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/records/paper']}>
          <Routes>
            <Route path="/records/:id" element={<PaperPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Read paper' }))
    expect(
      screen.getByRole('dialog', { name: 'Read paper' }),
    ).toBeInTheDocument()
    expect(await screen.findByTitle('Paper PDF viewer')).toHaveAttribute(
      'src',
      'blob:paper',
    )
    expect(apiDownload).toHaveBeenCalledWith(
      '/api/records/paper/download',
      null,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close reader' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:paper'))
    create.mockRestore()
    revoke.mockRestore()
  })
  it('refreshes the count after a signed-in user copies a citation', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { uid: 'u1' },
      getIdToken: async () => 'token',
    } as never)
    const paper = {
      id: 'paper-3',
      title: 'Paper',
      authors: null,
      authorList: [],
      publication: null,
      schoolName: null,
      courseName: null,
      year: null,
      visibility: 'PUBLIC',
      fullTextStatus: 'READY',
      keywords: [],
      citationCopyCount: 1,
    }
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path.startsWith('/api/records/')) return paper
      if (path.startsWith('/api/bookmarks/')) return { bookmarked: false }
      return { recorded: true }
    })
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/records/paper-3']}>
          <Routes>
            <Route path="/records/:id" element={<PaperPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy citation' }),
    )
    await waitFor(() =>
      expect(
        vi
          .mocked(apiFetch)
          .mock.calls.some(
            ([path, , init]) =>
              path === '/api/activity' &&
              JSON.parse(String(init?.body)).eventType === 'CITATION_COPY',
          ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(
        vi
          .mocked(apiFetch)
          .mock.calls.filter(([path]) => path === '/api/records/paper-3')
          .length,
      ).toBeGreaterThan(1),
    )
  })
  it('omits the keywords section when the paper has no keywords', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      getIdToken: async () => null,
    } as never)
    vi.mocked(apiFetch).mockResolvedValue({
      id: 'paper-2',
      title: 'Another paper',
      authors: null,
      authorList: [],
      publication: null,
      schoolName: null,
      courseName: null,
      year: null,
      visibility: 'PUBLIC',
      fullTextStatus: 'READY',
      keywords: [],
    })
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/records/paper-2']}>
          <Routes>
            <Route path="/records/:id" element={<PaperPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: 'Cite now' })
    expect(
      screen.queryByRole('heading', { name: 'Author keywords' }),
    ).not.toBeInTheDocument()
  })
  it('prioritizes citation and prominent paper actions without the access notice', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      getIdToken: async () => null,
    } as never)
    vi.mocked(apiFetch).mockResolvedValue({
      id: 'paper-1',
      title: 'Research paper',
      authors: 'A. Author',
      authorList: ['A. Author'],
      publication: null,
      schoolName: 'School',
      courseName: 'Program',
      year: '2026',
      visibility: 'PUBLIC',
      fullTextStatus: 'READY',
      keywords: ['Health'],
      citationCopyCount: 4,
    })
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={['/records/paper-1']}>
          <Routes>
            <Route path="/records/:id" element={<PaperPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const cite = await screen.findByRole('heading', { name: 'Cite now' })
    const about = screen.getByRole('heading', { name: 'Author keywords' })
    expect(
      cite.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByText('Publicly accessible')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'About this record' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(
      screen.getByText('Citation copies: 4 · Signed-in users, last 90 days'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add bookmark' })).toHaveClass(
      'h-12',
    )
    expect(screen.getByRole('button', { name: 'Download paper' })).toHaveClass(
      'h-12',
    )
    expect(
      screen.getByRole('link', { name: 'View relationships' }),
    ).toHaveAttribute('href', '/graph?record=paper-1')
    expect(
      screen.getByRole('link', { name: 'View relationships' }),
    ).toHaveClass('h-12')
  })
})
