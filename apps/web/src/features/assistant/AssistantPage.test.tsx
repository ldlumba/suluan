import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'
import { AssistantPage } from './AssistantPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/auth/SignInButton', () => ({
  SignInButton: () => <button>Sign in</button>,
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<object>()),
  apiFetch: vi.fn(),
}))

const config = {
  enabled: true,
  used: 0,
  limits: {
    messagesPerUserPerDay: 10,
    messagesPerDay: 130,
    promptChars: 1000,
    turnsPerConversation: 10,
    maxOutputTokens: 800,
    evidenceChunks: 5,
  },
}
function page() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssistantPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, client }
}
describe('assistant UI boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      profile: { id: 'user-1', role: 'USER' },
      loading: false,
      getIdToken: async () => 'test-token',
    } as never)
    vi.mocked(apiFetch).mockResolvedValue(config)
  })
  it('makes no assistant request while signed out', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: null,
      loading: false,
    } as never)
    page()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })
  it('keeps the privacy notice and new-conversation control without a second branded header in the floating panel', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AssistantPage floating />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(
      screen.getByText('Chat text is not saved by SULUAN'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'New conversation' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Repository-first guidance'),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByLabelText('Your research question'),
    ).toBeInTheDocument()
  })
  it('keeps disabled generation unavailable', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...config, enabled: false })
    page()
    expect(
      await screen.findByRole('button', { name: 'Ask assistant' }),
    ).toBeDisabled()
  })
  it('requires adult confirmation when all UA accounts are enabled', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ...config,
      accessMode: 'all_authenticated',
      requiresAdultConfirmation: true,
    })
    page()
    const composer = await screen.findByLabelText('Your research question')
    fireEvent.change(composer, { target: { value: 'A research question' } })
    expect(screen.getByRole('button', { name: 'Ask assistant' })).toBeDisabled()
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I confirm that I am 18 or older/i,
      }),
    )
    expect(screen.getByRole('button', { name: 'Ask assistant' })).toBeEnabled()
  })
  it('discloses the personal and shared daily limits', async () => {
    page()
    await screen.findByLabelText('Your research question')
    const disclosure = await screen.findByText('Privacy and AI limitations')
    expect(disclosure.closest('details')).toHaveTextContent(
      'Usage is limited to 10 messages per account and 130 shared messages across all users per UTC day.',
    )
  })
  it('shows non-interactive examples and sends from the chat composer with Enter', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path.endsWith('/limits')) return config as never
      return (await new Promise<unknown>((resolve) => {
        finish = resolve
      })) as never
    })
    page()
    await screen.findByRole('list', { name: 'Example questions' })
    expect(
      screen.queryByRole('button', {
        name: 'What does AgriKlima propose to help farmers?',
      }),
    ).not.toBeInTheDocument()
    const composer = screen.getByLabelText('Your research question')
    fireEvent.change(composer, {
      target: { value: 'What does AgriKlima propose to help farmers?' },
    })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false })
    expect(
      await screen.findByText('Considering your question…'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('What does AgriKlima propose to help farmers?'),
    ).toBeInTheDocument()
    expect(composer).toHaveValue('')
    await act(async () => {
      finish({
        mode: 'grounded_answer',
        turns: 1,
        used: 1,
        paragraphs: [{ text: 'Grounded answer', citations: ['S1'] }],
        sources: [],
      })
    })
    expect(await screen.findByText('Grounded answer')).toBeInTheDocument()
    expect(screen.getByText('Based on SULUAN papers')).toBeInTheDocument()
  })
  it('renders injected output as inert text with only server-owned source links', async () => {
    const attack =
      '<img src="https://attacker.invalid/steal" onerror="alert(1)"> [click](javascript:alert(1))'
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path.endsWith('/limits')
        ? config
        : ({
            mode: 'grounded_answer',
            turns: 1,
            used: 1,
            paragraphs: [{ text: attack, citations: ['S1'] }],
            sources: [
              {
                id: 'S1',
                recordId: 'paper-1',
                title: 'Study',
                excerpt: attack,
                year: '2026',
                matchType: 'semantic',
              },
            ],
          } as never),
    )
    const view = page()
    await screen.findByLabelText('Your research question')
    fireEvent.change(screen.getByLabelText('Your research question'), {
      target: { value: 'What did the study find?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }))
    expect(
      await screen.findByRole('link', { name: /\[S1\] Study/ }),
    ).toHaveAttribute('href', '/records/paper-1')
    expect(screen.getByRole('link', { name: /\[S1\] Study/ })).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(
      screen.getByRole('link', { name: /\[S1\] Study/ }),
    ).toHaveAccessibleName('[S1] Study (opens in a new tab)')
    const evidenceDrawer = screen
      .getByText(/Sources and evidence/)
      .closest('details')
    expect(evidenceDrawer).not.toHaveAttribute('open')
    fireEvent.click(screen.getByRole('button', { name: 'View evidence S1' }))
    expect(evidenceDrawer).toHaveAttribute('open')
    expect(await screen.findByText('Answer 1 ready.')).toHaveAttribute(
      'role',
      'status',
    )
    expect(
      screen.getByRole('link', { name: 'Go to latest answer' }),
    ).toHaveAttribute('href', '#assistant-answer-0')
    for (const mutation of view.client.getMutationCache().getAll()) {
      expect(mutation.state.variables).toBeUndefined()
      expect(mutation.state.data).toBeUndefined()
    }
    expect(view.container.querySelector('img,script')).toBeNull()
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(
      screen.getAllByText(attack, { exact: false }).length,
    ).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(
      screen.queryByRole('link', { name: /\[S1\] Study/ }),
    ).not.toBeInTheDocument()
    expect(view.client.getMutationCache().getAll()).toHaveLength(0)
  })
  it('aborts pending requests on unmount and never caches late answers', async () => {
    let finish!: (value: unknown) => void
    let signal: AbortSignal | undefined
    vi.mocked(apiFetch).mockImplementation(async (path, _token, options) => {
      if (path.endsWith('/limits')) return config as never
      signal = options?.signal as AbortSignal
      // Deliberately ignore abort to simulate a response racing with navigation.
      return (await new Promise<unknown>((resolve) => {
        finish = resolve
      })) as never
    })
    const view = page()
    await screen.findByLabelText('Your research question')
    fireEvent.change(screen.getByLabelText('Your research question'), {
      target: { value: 'Private test prompt' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }))
    await waitFor(() => expect(signal).toBeDefined())
    expect(
      view.client.getMutationCache().getAll()[0].state.variables,
    ).toBeUndefined()
    view.unmount()
    expect(signal?.aborted).toBe(true)
    expect(view.client.getMutationCache().getAll()).toHaveLength(0)
    await act(async () => {
      finish({
        mode: 'grounded_answer',
        turns: 1,
        used: 1,
        paragraphs: [{ text: 'Late answer', citations: ['S1'] }],
        sources: [],
      })
    })
    expect(view.client.getMutationCache().getAll()).toHaveLength(0)
  })
  it('labels general guidance and keeps exploratory papers separate', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path.endsWith('/limits')
        ? config
        : ({
            mode: 'general_guidance',
            turns: 1,
            used: 1,
            repositoryStatus: 'searched',
            paragraphs: [
              {
                text: 'You could narrow the topic by population and setting.',
                citations: [],
              },
            ],
            sources: [
              {
                id: 'S1',
                recordId: 'paper-1',
                title: 'A farming study',
                excerpt: 'An excerpt about agricultural work.',
                year: '2026',
                matchType: 'exploratory',
              },
            ],
          } as never),
    )
    page()
    await screen.findByLabelText('Your research question')
    fireEvent.change(screen.getByLabelText('Your research question'), {
      target: { value: 'Mental health for farmers?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }))

    expect(await screen.findByText('General guidance')).toBeInTheDocument()
    expect(
      screen.getByText(/not based on a directly matching SULUAN paper/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View evidence/ })).toBeNull()
    expect(screen.getByText('Repository papers to explore')).toBeInTheDocument()
    expect(screen.getByText('Possibly related')).toBeInTheDocument()
  })
  it('labels guidance produced while repository retrieval is unavailable', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path.endsWith('/limits')
        ? config
        : ({
            mode: 'general_guidance',
            turns: 1,
            used: 1,
            repositoryStatus: 'retrieval_unavailable',
            paragraphs: [
              { text: 'Start by defining the population.', citations: [] },
            ],
            sources: [],
          } as never),
    )
    page()
    await screen.findByLabelText('Your research question')
    fireEvent.change(screen.getByLabelText('Your research question'), {
      target: { value: 'Help me shape a topic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }))
    expect(
      await screen.findByText(/repository retrieval was unavailable/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('Repository papers to explore')).toBeNull()
  })
  it('shows the server cooldown reason instead of a generic 429 message', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path.endsWith('/limits')) return config as never
      throw new ApiError(
        429,
        'Please wait 6 seconds before sending another message. The cooldown also applies after starting a new conversation.',
        'assistant_cooldown',
      )
    })
    page()
    await screen.findByLabelText('Your research question')
    fireEvent.change(screen.getByLabelText('Your research question'), {
      target: { value: 'A new question' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }))
    expect(
      await screen.findByText(/Please wait 6 seconds.*new conversation/i),
    ).toBeInTheDocument()
  })
  it('explains non-pilot eligibility separately from server availability', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ...config,
      enabled: false,
      pilotEligible: false,
    })
    page()
    expect(
      await screen.findByText(/not included in the invited adult pilot/),
    ).toBeInTheDocument()
  })
  it('does not automatically retry a failed generation', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path.endsWith('/limits')) return config as never
      throw new Error('unavailable')
    })
    page()
    await screen.findByLabelText('Your research question')
    fireEvent.change(screen.getByLabelText('Your research question'), {
      target: { value: 'Research question' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No automatic retry'),
    )
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([p]) => p.endsWith('/messages')),
    ).toHaveLength(1)
  })
})
