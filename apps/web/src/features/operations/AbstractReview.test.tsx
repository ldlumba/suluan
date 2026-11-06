import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { apiFetch } from '@/lib/api'
import { AbstractReview } from './AbstractReview'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }))

describe('abstract review', () => {
  it('shows a candidate for review and saves only after explicit approval', async () => {
    vi.mocked(useAuth).mockReturnValue({
      getIdToken: async () => 'token',
    } as never)
    vi.mocked(apiFetch).mockImplementation(async (_path, _token, options) =>
      options?.method === 'PATCH'
        ? { ok: true }
        : {
            abstract: null,
            candidate: 'Extracted text',
            approved: false,
            updatedAt: '2026-11-05T00:00:00Z',
            processingStatus: 'EXTRACTED',
          },
    )
    const close = vi.fn()
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AbstractReview
          paper={{ id: 'paper', title: 'Paper' }}
          onClose={close}
        />
      </QueryClientProvider>,
    )
    expect(await screen.findByLabelText('Abstract')).toHaveValue(
      'Extracted text',
    )
    fireEvent.change(screen.getByLabelText('Abstract'), {
      target: { value: 'Corrected abstract' },
    })
    expect(
      vi
        .mocked(apiFetch)
        .mock.calls.some(([, , options]) => options?.method === 'PATCH'),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Approve and save' }))
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/record-access/paper/abstract',
        'token',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            abstract: 'Corrected abstract',
            expectedUpdatedAt: '2026-11-05T00:00:00Z',
          }),
        }),
      ),
    )
    await waitFor(() => expect(close).toHaveBeenCalled())
  })
})
