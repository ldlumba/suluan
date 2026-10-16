import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router'
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronDown,
  Compass,
  FileSearch,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/useAuth'
import { SignInButton } from '@/features/auth/SignInButton'
import { ApiError, apiFetch } from '@/lib/api'

type Limits = {
  enabled: boolean
  pilotEligible?: boolean
  accessMode?: 'pilot' | 'all_authenticated'
  requiresAdultConfirmation?: boolean
  used: number
  limits: {
    messagesPerUserPerDay: number
    messagesPerDay: number
    promptChars: number
    turnsPerConversation: number
    maxOutputTokens: number
    evidenceChunks: number
  }
}

type Answer = {
  mode:
    | 'grounded_answer'
    | 'related_research'
    | 'general_guidance'
    | 'clarification'
  turns: number
  used: number
  repositoryStatus?: 'searched' | 'retrieval_unavailable'
  paragraphs: { text: string; citations: string[] }[]
  sources: {
    id: string
    recordId: string
    title: string
    year: string | null
    excerpt: string
    matchType: 'semantic' | 'exploratory' | 'keyword'
  }[]
}

function assistantErrorMessage(error: unknown) {
  if (!(error instanceof ApiError))
    return 'The assistant could not return an answer. No automatic retry was made. Please use search or try again later.'
  if (error.status === 403)
    return 'This account does not have access to the research assistant. Use search instead.'
  if (error.code === 'adult_confirmation_required') return error.message
  if (error.status !== 429)
    return 'The assistant could not return an answer. No automatic retry was made. Please use search or try again later.'
  if (
    error.code === 'assistant_cooldown' ||
    error.code === 'assistant_daily_limit' ||
    error.code === 'assistant_global_limit' ||
    error.code === 'assistant_conversation_limit'
  ) {
    return error.message
  }
  if (error.code === 'retrieval_limit')
    return 'Repository retrieval has reached its staging limit. Please try again after midnight UTC.'
  return error.message === 'Request failed.'
    ? 'A usage limit was reached. Please try again later.'
    : error.message
}

const STARTERS = [
  'What does AgriKlima propose to help farmers?',
  'Help me shape a research topic about student mental health during OJT.',
  'How can I narrow a study about farmers’ well-being?',
]

export function AssistantPage() {
  const { profile, loading } = useAuth()
  if (loading) return <p role="status">Checking access…</p>
  if (!profile)
    return (
      <section className="mx-auto max-w-2xl space-y-5 py-6 sm:py-12">
        <h1 className="display-heading text-4xl font-semibold">
          Sign in to chat with the research assistant
        </h1>
        <p className="leading-7 text-muted-foreground">
          Sign in with your authorized UA Google account to use the research
          assistant. You must be 18 or older.
        </p>
        <div className="flex flex-wrap gap-3">
          <SignInButton />
          <Link to="/search" className={buttonVariants({ variant: 'outline' })}>
            Browse research instead
          </Link>
        </div>
      </section>
    )
  return <AssistantConversation key={profile.id} />
}

function AssistantConversation() {
  const { profile, getIdToken } = useAuth()
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const [turns, setTurns] = useState<{ question: string; answer: Answer }[]>([])
  const [attempts, setAttempts] = useState(0)
  const [adultConfirmed, setAdultConfirmed] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [mutationScope] = useState(() => crypto.randomUUID())
  const active = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const conversationEndRef = useRef<HTMLDivElement | null>(null)
  const pendingInput = useRef<{
    prompt: string
    sessionId: string
    history: { question: string; answer: string }[]
  } | null>(null)

  function clearMutationCache() {
    const cache = queryClient.getMutationCache()
    for (const mutation of cache.findAll({
      mutationKey: ['assistant-message', mutationScope],
      exact: true,
    })) {
      cache.remove(mutation)
    }
  }

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      pendingInput.current = null
      controller.current?.abort()
      const cache = queryClient.getMutationCache()
      for (const mutation of cache.findAll({
        mutationKey: ['assistant-message', mutationScope],
        exact: true,
      })) {
        cache.remove(mutation)
      }
    }
  }, [queryClient, mutationScope])

  useEffect(() => {
    if (turns.length || pendingQuestion) {
      conversationEndRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [turns.length, pendingQuestion])

  const config = useQuery({
    queryKey: ['assistant-limits', profile?.id],
    retry: false,
    queryFn: async () =>
      apiFetch<Limits>('/api/assistant/limits', await getIdToken()),
  })
  const limits = config.data?.limits
  const schema = z.object({
    prompt: z
      .string()
      .trim()
      .min(1, 'Enter a research question.')
      .max(limits?.promptChars ?? 0),
  })
  const form = useForm<{ prompt: string }>({
    resolver: zodResolver(schema),
    defaultValues: { prompt: '' },
  })
  const prompt = useWatch({ control: form.control, name: 'prompt' }) ?? ''
  const send = useMutation({
    mutationKey: ['assistant-message', mutationScope],
    gcTime: 0,
    retry: false,
    // Sensitive input/output never becomes mutation variables or cached data.
    // Aborting a browser fetch does not refund or cancel server-side paid work.
    mutationFn: async () => {
      const input = pendingInput.current
      pendingInput.current = null
      if (!input || !active.current) return
      const abort = new AbortController()
      controller.current = abort
      const token = await getIdToken()
      if (!active.current || abort.signal.aborted) return
      const answer = await apiFetch<Answer>('/api/assistant/messages', token, {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          adultConfirmed,
          ...input,
        }),
      })
      if (!active.current || abort.signal.aborted) return
      setTurns((previous) => [...previous, { question: input.prompt, answer }])
      setPendingQuestion(null)
      setAttempts(answer.turns)
      form.reset()
    },
    onSettled: () => {
      controller.current = null
      if (active.current) {
        setPendingQuestion(null)
        void queryClient.invalidateQueries({ queryKey: ['assistant-limits'] })
      }
    },
  })
  const exhausted = Boolean(limits && attempts >= limits.turnsPerConversation)
  const dailyExhausted = Boolean(
    limits && (config.data?.used ?? 0) >= limits.messagesPerUserPerDay,
  )
  const unavailable = !config.data?.enabled
  const needsAdultConfirmation = Boolean(
    config.data?.requiresAdultConfirmation && !adultConfirmed,
  )
  const composerDisabled =
    unavailable ||
    needsAdultConfirmation ||
    send.isPending ||
    exhausted ||
    dailyExhausted

  function startNewConversation() {
    setSessionId(crypto.randomUUID())
    setTurns([])
    setAttempts(0)
    setPendingQuestion(null)
    send.reset()
    clearMutationCache()
    form.reset()
    requestAnimationFrame(() => promptRef.current?.focus())
  }

  function submitPrompt(value: string) {
    const cleanPrompt = value.trim()
    if (!cleanPrompt || composerDisabled) return
    setAttempts((count) => count + 1)
    setPendingQuestion(cleanPrompt)
    pendingInput.current = {
      prompt: cleanPrompt,
      sessionId,
      history: turns.slice(-4).map((turn) => ({
        question: turn.question,
        answer: turn.answer.paragraphs.map((p) => p.text).join('\n\n'),
      })),
    }
    form.reset()
    send.mutate()
  }

  return (
    <section className="mx-auto flex min-h-[calc(100svh-15rem)] max-w-5xl flex-col gap-4">
      <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display-heading text-3xl font-semibold sm:text-4xl">
            Research assistant
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Explore SULUAN’s public research, shape research ideas, and ask
            follow-up questions. Repository findings stay tied to cited papers.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <ShieldCheck
            className="size-4 text-[var(--primary)]"
            aria-hidden="true"
          />
          Chat text is not saved by SULUAN
        </div>
      </header>

      <div className="flex min-h-[36rem] flex-1 flex-col overflow-hidden rounded-[8px] border border-border bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--primary)] px-4 py-3 text-white sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[6px] bg-[var(--highlight)] text-[var(--primary)]">
              <Bot className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">SULUAN Assistant</p>
              <p className="text-xs text-white/70">Repository-first guidance</p>
            </div>
          </div>
          <Button
            type="button"
            aria-label="New conversation"
            variant="ghost"
            size="sm"
            className="border border-white/20 text-white hover:bg-white/10 hover:text-white"
            disabled={send.isPending}
            onClick={startNewConversation}
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">New conversation</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            className="min-h-0 flex-1 overflow-y-auto bg-[var(--background)] px-4 py-5 sm:px-6 sm:py-7"
            aria-label="Conversation"
          >
            {config.isPending && (
              <div className="grid min-h-full place-items-center">
                <p role="status" className="text-sm text-muted-foreground">
                  Loading assistant availability…
                </p>
              </div>
            )}

            {config.isError && (
              <ConversationNotice tone="error">
                {config.error instanceof ApiError && config.error.status === 403
                  ? 'This account does not have access to the invited pilot.'
                  : 'Could not load assistant availability.'}{' '}
                <Link className="font-medium underline" to="/search">
                  Use search
                </Link>{' '}
                or reload this page.
              </ConversationNotice>
            )}

            {config.data && !config.data.enabled && (
              <ConversationNotice>
                {config.data.accessMode !== 'all_authenticated' &&
                config.data.pilotEligible === false
                  ? 'This account is not included in the invited adult pilot.'
                  : 'The assistant is temporarily unavailable.'}{' '}
                You can still{' '}
                <Link className="font-medium underline" to="/search">
                  search the repository
                </Link>
                .
              </ConversationNotice>
            )}

            {turns.length === 0 && !pendingQuestion && config.data?.enabled && (
              <EmptyConversation />
            )}

            <ol className="mx-auto max-w-3xl space-y-6" aria-label="Messages">
              {turns.map((turn, index) => (
                <li key={index} className="space-y-4">
                  <UserMessage text={turn.question} />
                  <AssistantMessage turn={turn} index={index} />
                </li>
              ))}
              {pendingQuestion && (
                <li className="space-y-4">
                  <UserMessage text={pendingQuestion} />
                  <div className="flex items-start gap-3" role="status">
                    <Avatar assistant />
                    <div className="rounded-[8px] rounded-tl-[3px] border border-border bg-white px-4 py-3.5 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-1.5 animate-pulse rounded-full bg-[var(--primary)]" />
                        <span className="size-1.5 animate-pulse rounded-full bg-[var(--primary)] [animation-delay:150ms]" />
                        <span className="size-1.5 animate-pulse rounded-full bg-[var(--primary)] [animation-delay:300ms]" />
                        <span className="ml-1">Considering your question…</span>
                      </span>
                    </div>
                  </div>
                </li>
              )}
            </ol>

            {send.isError && (
              <div className="mx-auto mt-5 max-w-3xl">
                <ConversationNotice tone="error">
                  {assistantErrorMessage(send.error)}
                </ConversationNotice>
              </div>
            )}

            {exhausted && (
              <div className="mx-auto mt-5 max-w-3xl">
                <ConversationNotice>
                  This conversation has reached its turn limit. Start a new
                  conversation to continue within your daily allowance.
                </ConversationNotice>
              </div>
            )}

            <div ref={conversationEndRef} />
          </div>

          {limits && (
            <form
              className="border-t border-border bg-white p-3 sm:p-4"
              onSubmit={(event) => {
                void form.handleSubmit(({ prompt: value }) =>
                  submitPrompt(value),
                )(event)
              }}
            >
              <div className="mx-auto max-w-3xl">
                {config.data?.requiresAdultConfirmation && (
                  <label className="mb-3 flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={adultConfirmed}
                      onChange={(event) =>
                        setAdultConfirmed(event.target.checked)
                      }
                      className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span>
                      I confirm that I am 18 or older and will not include
                      personal, confidential, or unpublished information.
                    </span>
                  </label>
                )}
                <Label htmlFor="assistant-prompt" className="sr-only">
                  Your research question
                </Label>
                <div className="flex items-end gap-2 rounded-[8px] border border-input bg-white p-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
                  <textarea
                    id="assistant-prompt"
                    rows={2}
                    maxLength={limits.promptChars}
                    aria-describedby="assistant-allowance assistant-prompt-error"
                    aria-invalid={Boolean(form.formState.errors.prompt)}
                    placeholder="Ask about a paper, finding, or research topic…"
                    className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground sm:text-base"
                    disabled={composerDisabled}
                    {...form.register('prompt')}
                    ref={(element) => {
                      form.register('prompt').ref(element)
                      promptRef.current = element
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void form.handleSubmit(({ prompt: value }) =>
                          submitPrompt(value),
                        )()
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    size="icon-lg"
                    aria-label="Ask assistant"
                    className="mb-0.5 shrink-0 bg-[var(--primary)]"
                    disabled={composerDisabled || !prompt.trim()}
                  >
                    <Send className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <p id="assistant-allowance">
                    {config.data?.used ?? 0}/{limits.messagesPerUserPerDay}{' '}
                    attempts today · {attempts}/{limits.turnsPerConversation}{' '}
                    turns · {prompt.length}/{limits.promptChars} characters
                  </p>
                  <p className="hidden sm:block">
                    Enter to send · Shift+Enter for a new line
                  </p>
                </div>
                <p
                  id="assistant-prompt-error"
                  className="mt-1 text-xs text-destructive"
                  role={form.formState.errors.prompt ? 'alert' : undefined}
                >
                  {form.formState.errors.prompt?.message}
                </p>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <details className="group max-w-3xl">
          <summary className="cursor-pointer list-none font-medium text-foreground underline decoration-border underline-offset-4">
            Privacy and AI limitations
            <ChevronDown
              className="ml-1 inline size-3.5 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <p className="mt-2">
            Your question, recent conversation, and public evidence are sent to
            Google Gemini. Do not include personal or confidential information.
            General guidance can draw on the model’s knowledge and may be
            incomplete or wrong; it is labeled separately from repository
            evidence. SULUAN uses the paid Gemini API; Google states that paid
            inputs and outputs are not used to improve its products. Provider
            processing and retention terms still apply.{' '}
            <a
              href="https://ai.google.dev/gemini-api/terms"
              className="font-medium underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Provider terms
            </a>
            . Failed attempts can count toward limits.
            {limits && (
              <>
                {' '}
                Usage is limited to {limits.messagesPerUserPerDay} messages per
                account and {limits.messagesPerDay} shared messages across all
                users per UTC day.
              </>
            )}
          </p>
        </details>
        <Link
          to="/search"
          className="inline-flex shrink-0 items-center gap-1.5 font-medium text-[var(--primary)] underline underline-offset-4"
        >
          <FileSearch className="size-3.5" aria-hidden="true" /> Search papers
        </Link>
      </div>

      <p className="sr-only" role="status" aria-atomic="true">
        {send.isSuccess && turns.length > 0
          ? `Answer ${turns.length} ready.`
          : ''}
      </p>
      {send.isSuccess && turns.length > 0 && (
        <a
          className="sr-only focus:not-sr-only"
          href={`#assistant-answer-${turns.length - 1}`}
        >
          Go to latest answer
        </a>
      )}
    </section>
  )
}

function EmptyConversation() {
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center py-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-[8px] bg-[var(--primary)] text-white">
        <BookOpen className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-xl font-semibold sm:text-2xl">
        Start with a research question
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        Name a topic or paper. The assistant starts with accessible public
        SULUAN research, then clearly labels broader guidance when the
        repository does not directly answer your question.
      </p>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Example questions
      </p>
      <ul
        className="mt-2 grid w-full gap-2 text-left sm:grid-cols-3"
        aria-label="Example questions"
      >
        {STARTERS.map((starter) => (
          <li
            key={starter}
            className="rounded-[8px] border border-border bg-white p-3 text-sm leading-5 text-muted-foreground"
          >
            “{starter}”
          </li>
        ))}
      </ul>
    </div>
  )
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[85%] rounded-[8px] rounded-tr-[3px] bg-[var(--primary)] px-4 py-3 text-sm leading-6 text-white sm:max-w-[72%] sm:text-base">
        <p className="whitespace-pre-wrap break-words">{text}</p>
      </div>
      <Avatar />
    </div>
  )
}

function AssistantMessage({
  turn,
  index,
}: {
  turn: { question: string; answer: Answer }
  index: number
}) {
  const presentation = {
    grounded_answer: {
      label: 'Based on SULUAN papers',
      note: 'Repository claims below are tied to the cited public evidence.',
      icon: BookOpen,
    },
    related_research: {
      label: 'Possibly related SULUAN research',
      note: 'These papers may help you explore the topic, but they do not directly establish the answer.',
      icon: FileSearch,
    },
    general_guidance: {
      label: 'General guidance',
      note: 'This response is not based on a directly matching SULUAN paper.',
      icon: Compass,
    },
    clarification: {
      label: 'Clarifying question',
      note: 'A little more detail will help the assistant give a more useful response.',
      icon: MessageSquarePlus,
    },
  }[turn.answer.mode]
  const ModeIcon = presentation.icon
  const sourceHeading =
    turn.answer.mode === 'general_guidance'
      ? 'Repository papers to explore'
      : turn.answer.mode === 'related_research'
        ? 'Related SULUAN papers'
        : 'Sources and evidence'

  return (
    <div className="flex items-start gap-3">
      <Avatar assistant />
      <article
        id={`assistant-answer-${index}`}
        tabIndex={-1}
        className="min-w-0 max-w-[92%] scroll-mt-24 sm:max-w-[82%]"
        aria-label="Assistant answer"
      >
        <div className="rounded-[8px] rounded-tl-[3px] border border-border bg-white px-4 py-3.5 sm:px-5">
          <div className="mb-3 flex gap-2.5 border-b border-border pb-3">
            <ModeIcon
              className="mt-0.5 size-4 shrink-0 text-[var(--primary)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {presentation.label}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {presentation.note}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {turn.answer.paragraphs.map((paragraph, paragraphIndex) => (
              <p
                key={paragraphIndex}
                className="whitespace-pre-wrap break-words text-sm leading-6 sm:text-base sm:leading-7"
              >
                {paragraph.text}{' '}
                {paragraph.citations.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="ml-1 inline-flex min-w-7 items-center justify-center rounded-[4px] bg-[var(--highlight)] px-1.5 py-0.5 text-xs font-bold text-[var(--primary)] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={`View evidence ${id}`}
                    onClick={() => {
                      const details = document.getElementById(
                        `sources-${index}`,
                      ) as HTMLDetailsElement | null
                      if (details) details.open = true
                      requestAnimationFrame(() =>
                        document
                          .getElementById(`source-${index}-${id}`)
                          ?.scrollIntoView?.({
                            behavior: 'smooth',
                            block: 'nearest',
                          }),
                      )
                    }}
                  >
                    {id}
                  </button>
                ))}
              </p>
            ))}
          </div>
          {turn.answer.repositoryStatus === 'retrieval_unavailable' && (
            <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
              Repository retrieval was unavailable for this response. Any
              guidance above comes from the model’s general knowledge, not from
              a search of SULUAN papers.
            </p>
          )}
        </div>

        {turn.answer.sources.length > 0 && (
          <details
            id={`sources-${index}`}
            className="group mt-2 overflow-hidden rounded-[8px] border border-border bg-white"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold hover:bg-[var(--secondary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
              <span>
                {sourceHeading}{' '}
                <span className="font-normal text-muted-foreground">
                  ({turn.answer.sources.length})
                </span>
              </span>
              <ChevronDown
                className="size-4 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {turn.answer.sources.map((source) => (
                <li
                  key={source.id}
                  id={`source-${index}-${source.id}`}
                  className="scroll-mt-24 px-4 py-4"
                >
                  <Link
                    className="font-medium text-[var(--primary)] underline underline-offset-4"
                    to={`/records/${source.recordId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    [{source.id}] {source.title}{' '}
                    <span className="sr-only">(opens in a new tab)</span>
                    <ArrowUpRight
                      className="inline size-4"
                      aria-hidden="true"
                    />
                  </Link>
                  <p className="mt-2 text-xs font-semibold text-[var(--primary)]">
                    {source.matchType === 'semantic'
                      ? 'Related by meaning'
                      : source.matchType === 'exploratory'
                        ? 'Possibly related'
                        : 'Keyword match'}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {source.excerpt}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </article>
    </div>
  )
}

function Avatar({ assistant = false }: { assistant?: boolean }) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-[6px] ${
        assistant
          ? 'bg-[var(--highlight)] text-[var(--primary)]'
          : 'border border-border bg-white text-[var(--primary)]'
      }`}
      aria-hidden="true"
    >
      {assistant ? (
        <Bot className="size-4" />
      ) : (
        <UserRound className="size-4" />
      )}
    </span>
  )
}

function ConversationNotice({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'error'
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mx-auto max-w-2xl rounded-[8px] border px-4 py-3 text-sm leading-6 ${
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-foreground'
          : 'border-border bg-white text-muted-foreground'
      }`}
    >
      {children}
    </div>
  )
}
