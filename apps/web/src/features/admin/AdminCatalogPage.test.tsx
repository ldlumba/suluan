import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { AdminCatalogPage } from './AdminCatalogPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
}))

function renderPage(role: 'USER' | 'ADMIN' = 'ADMIN') {
  vi.mocked(useAuth).mockReturnValue({
    user: { email: 'admin@ua.edu.ph' },
    profile: { id: 'admin-1', role },
    loading: false,
    getIdToken: async () => 'token',
  } as never)
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AdminCatalogPage />
    </QueryClientProvider>,
  )
}

describe('admin course availability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the page admin-only', () => {
    renderPage('USER')
    expect(screen.getByText(/only administrators/i)).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('hides a course using its loaded version', async () => {
    const row = {
      schoolId: 'school-1',
      schoolName: 'School of Health',
      id: 'course-1',
      name: 'BS Nursing',
      active: true,
      updatedAt: '2026-10-13T10:00:00.000Z',
    }
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path === '/api/admin/catalog' ? [row] : { ...row, active: false },
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Hide course' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/admin/courses/course-1',
        'token',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            active: false,
            expectedUpdatedAt: row.updatedAt,
          }),
        }),
      ),
    )
  })
})
