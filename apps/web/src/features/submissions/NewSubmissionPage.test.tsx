import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <NewSubmissionPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('NewSubmissionPage catalog UX', () => {
  it('shows the compact catalog helper without a year field', async () => {
    renderPage()

    expect(screen.queryByLabelText('Research type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/year is assigned automatically/i),
    ).not.toBeInTheDocument()

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

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
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
      .find((init) => init?.method === 'POST' && init.body instanceof FormData)
    const parts = (post?.body as FormData).getAll('keywords[]')
    expect(parts).toEqual(['Alpha', 'Beta'])
  })

  it('requires explicit confirmation for a possible duplicate title', async () => {
    renderPage()
    let submissionCalls = 0
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method !== 'POST')
        return new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      submissionCalls += 1
      if (submissionCalls === 1)
        return new Response(
          JSON.stringify({
            error: 'possible_duplicate',
            message: 'A pending or accepted paper already uses this title.',
            publicMatches: [
              {
                recordId: '11111111-1111-4111-8111-111111111111',
                title: 'Existing title',
                year: '2026',
              },
            ],
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        )
      return new Response(
        JSON.stringify({ id: 'submission-1', status: 'PENDING' }),
        {
          status: 201,
          headers: { 'content-type': 'application/json' },
        },
      )
    })
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Existing title' },
    })
    fireEvent.change(screen.getByLabelText(/Document/), {
      target: {
        files: [new File(['paper'], 'paper.pdf', { type: 'application/pdf' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(
      await screen.findByText('Possible duplicate title'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Existing title')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit as a different paper' }),
    )
    expect(await screen.findByText('Submission received')).toBeInTheDocument()
    const postBodies = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => init?.body as FormData)
    expect(postBodies[0].get('duplicateAcknowledged')).toBeNull()
    expect(postBodies[1].get('duplicateAcknowledged')).toBe('true')
  })

  it('shows the drag-and-drop target and author format hint', async () => {
    renderPage()
    expect(
      await screen.findByText(/drag and drop your file here/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Choose file' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/one author per line/i)).toBeInTheDocument()
    expect(screen.getByText(/dela cruz/i)).toBeInTheDocument()
  })
})
