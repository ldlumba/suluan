import type { ReactNode } from 'react'
import { Link } from 'react-router'
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronDown,
  Compass,
  FileSearch,
  MessageSquarePlus,
  UserRound,
} from 'lucide-react'

export type AssistantAnswer = {
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

const STARTERS = [
  'What does AgriKlima propose to help farmers?',
  'Help me shape a research topic about student mental health during OJT.',
  'How can I narrow a study about farmers’ well-being?',
]

export function EmptyConversation() {
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

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="max-w-[85%] rounded-[8px] rounded-tr-[3px] bg-[var(--primary)] px-4 py-3 text-sm leading-6 text-white sm:max-w-[72%] sm:text-base">
        <p className="whitespace-pre-wrap break-words">{text}</p>
      </div>
      <Avatar />
    </div>
  )
}

export function AssistantMessage({
  turn,
  index,
}: {
  turn: { question: string; answer: AssistantAnswer }
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

export function Avatar({ assistant = false }: { assistant?: boolean }) {
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

export function ConversationNotice({
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
