import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { PaperPage } from './PaperPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
}))

describe('paper page', () => {
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
    const about = screen.getByRole('heading', { name: 'About this record' })
    expect(
      cite.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.queryByText('Publicly accessible')).not.toBeInTheDocument()
    expect(screen.getByText('Health')).toBeInTheDocument()
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
