import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { NewSubmissionPage } from './NewSubmissionPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))

const mockedUseAuth = vi.mocked(useAuth)

const catalog = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'School of Health, Arts and Sciences',
    courses: [
      {
        id: '20000000-0000-4000-8000-000000000001',
        name: 'BS Nursing',
      },
    ],
  },
]

function renderPage() {
  mockedUseAuth.mockReturnValue({
    user: { email: 'student@ua.edu.ph' },
    profile: { id: 'p1', email: 'student@ua.edu.ph', role: 'USER' },
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    getIdToken: vi.fn().mockResolvedValue('token'),
  } as never)
  vi.stubGlobal(
    'fetch',
    // Fresh Response per call: bodies are single-use, and the page fetches
    // the catalog first, then POSTs the submission through the same stub.
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <NewSubmissionPage />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('NewSubmissionPage catalog UX', () => {
  it('shows the compact catalog helper and derives year at acceptance', async () => {
    renderPage()

    expect(screen.queryByLabelText('Research type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument()
    expect(
      screen.getByText(/year is assigned automatically/i),
    ).toBeInTheDocument()

    const nursing = await screen.findByRole('button', { name: 'BS Nursing' })
    expect(nursing).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(nursing)
    expect(nursing).toHaveAttribute('aria-pressed', 'true')
  })

  it('collects keyword chips and sends one part per keyword', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Keyword UI Study' },
    })
    fireEvent.change(screen.getByLabelText(/Document/), {
      target: {
        files: [
          new File(['x'.repeat(10)], 'paper.pdf', {
            type: 'application/pdf',
          }),
        ],
      },
    })
    const input = screen.getByLabelText(/Keywords/)
    // Comma commits immediately; Enter commits the draft.
    fireEvent.change(input, { target: { value: 'Alpha,' } })
    fireEvent.change(input, { target: { value: 'alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Case-insensitive duplicates collapse to the first chip.
    expect(
      await screen.findByRole('button', { name: 'Remove keyword Alpha' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove keyword Beta' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove keyword alpha' }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Submit for review' }),
    )
    await waitFor(() => {
      const posts = vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === 'POST')
      expect(posts.length).toBeGreaterThan(0)
    })
    expect(await screen.findByText('Submission received')).toBeInTheDocument()
    const post = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => init)
      .find(
        (init) =>
          init?.method === 'POST' && init.body instanceof FormData,
      )
    const parts = (post?.body as FormData).getAll('keywords[]')
    expect(parts).toEqual(['Alpha', 'Beta'])
  })
})
