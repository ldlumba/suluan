import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { RecordAccessPage } from './RecordAccessPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
}))

describe('repository access review', () => {
  it('requires a reason to withdraw and sends the current version', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { id: 'manager' },
      getIdToken: async () => 'token',
    } as never)
    vi.mocked(apiFetch).mockImplementation(
      async (path: string, _token, options) => {
        if (options?.method === 'PATCH') return { ok: true }
        if (path === '/api/schools') return []
        return {
          items: [
            {
              id: 'paper',
              title: 'Paper',
              year: 2026,
              visibility: 'PUBLIC',
              effectiveVisibility: 'PUBLIC',
              embargoUntil: null,
              updatedAt: '2026-11-03T10:00:00Z',
              schoolName: null,
              courseName: null,
              keywords: [],
              withdrawnAt: null,
            },
          ],
          hasMore: false,
        }
      },
    )
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <RecordAccessPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Withdraw paper' }),
    )
    expect(
      screen.getByRole('button', { name: 'Confirm withdrawal' }),
    ).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'Accidental acceptance' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/record-access/paper/lifecycle',
        'token',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            action: 'withdraw',
            reason: 'Accidental acceptance',
            expectedUpdatedAt: '2026-11-03T10:00:00Z',
          }),
        }),
      ),
    )
  })
  it('lists accepted papers and saves a fenced access change', async () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { id: 'manager' },
      getIdToken: async () => 'token',
    } as never)
    vi.mocked(apiFetch).mockImplementation(
      async (path: string, _token, options) => {
        if (options?.method === 'PATCH') return { ok: true }
        if (path === '/api/schools') return []
        return {
          items: [
            {
              id: 'paper',
              title: 'Accepted paper',
              year: 2026,
              visibility: 'PUBLIC',
              effectiveVisibility: 'PUBLIC',
              embargoUntil: null,
              updatedAt: '2026-11-03T10:00:00Z',
              schoolName: null,
              courseName: null,
              keywords: ['Existing'],
            },
          ],
          hasMore: false,
        }
      },
    )
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <RecordAccessPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Accepted paper')).toBeInTheDocument()
    expect(screen.getByText('Public')).toHaveClass('text-emerald-900')
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'newest' },
    })
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=newest'),
        'token',
      ),
    )
    expect(
      screen.getByRole('button', { name: 'Change access' }).parentElement,
    ).toHaveClass('space-y-4')
    fireEvent.click(screen.getByRole('button', { name: 'Edit keywords' }))
    expect(screen.getByText('Existing')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove keyword Existing' }),
    )
    fireEvent.change(screen.getByLabelText('Keywords (optional, up to 5)'), {
      target: { value: 'Revised' },
    })
    fireEvent.keyDown(screen.getByLabelText('Keywords (optional, up to 5)'), {
      key: 'Enter',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save keywords' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/record-access/paper/keywords',
        'token',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            keywords: ['Revised'],
            expectedUpdatedAt: '2026-11-03T10:00:00Z',
          }),
        }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Change access' }))
    fireEvent.change(screen.getByLabelText('Access'), {
      target: { value: 'RESTRICTED' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/record-access/paper',
        'token',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            visibility: 'RESTRICTED',
            embargoUntil: null,
            expectedUpdatedAt: '2026-11-03T10:00:00Z',
          }),
        }),
      ),
    )
  })
})
