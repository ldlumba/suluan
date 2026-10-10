import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { BookOpen, Network, Search, SlidersHorizontal, X } from 'lucide-react'
import { z } from 'zod'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

const formSchema = z.object({
  q: z.string().trim().max(200, 'Use at most 200 characters.'),
})
interface SearchItem {
  id: string
  title: string
  authors: string | null
  schoolName: string | null
  courseName: string | null
  year: string | null
  keywords: string[]
  snippet: string | null
  fullTextStatus: 'READY' | 'PENDING' | 'FAILED'
  visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
}

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'course', label: 'Course A–Z' },
] as const
type SearchSort = (typeof SORT_OPTIONS)[number]['value']

function isSearchSort(value: string | null): value is SearchSort {
  return SORT_OPTIONS.some((option) => option.value === value)
}
interface KeywordResult {
  items: SearchItem[]
  page: number
  hasMore: boolean
}
/**
 * Semantic search degrades rather than failing: `semanticStatus` explains why
 * nothing came back, and the UI falls back to keyword results in that case.
 */
interface SemanticResult extends KeywordResult {
  semanticStatus:
    | 'ready'
    | 'empty_query'
    | 'unconfigured'
    | 'quota_exhausted'
    | 'provider_error'
    | 'unavailable'
    | 'authentication_required'
  reason?: string
}

const SEMANTIC_NOTICE: Record<string, string> = {
  unconfigured: 'Semantic search is not configured on this server.',
  quota_exhausted:
    'The semantic search daily limit is reached. Showing keyword results instead.',
  provider_error:
    'The embedding provider is unavailable. Showing keyword results instead.',
  unavailable:
    'Semantic search is temporarily unavailable. Showing keyword results instead.',
  empty_query: 'Enter a description to search semantically.',
  authentication_required:
    'Sign in with your UA account to use semantic search. Showing keyword results instead.',
}

/**
 * Exact-match author-keyword filter. Deliberately NOT a <form>: it lives
 * inside the page next to the main search form, and nested forms submit
 * natively past React's onSubmit (observed live 2026-10-05 as a bare
 * `?kw=…` GET). A controlled input plus explicit Apply/Clear buttons has
 * no native-submit footgun.
 */
function KeywordFilter({
  initial,
  onApply,
}: {
  initial: string
  onApply: (next: string) => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
      <Label className="sm:whitespace-nowrap" htmlFor="search-keyword">
        Filter by author keyword (exact match)
      </Label>
      <div className="flex min-w-0 flex-1 gap-2 sm:min-w-56">
        <Input
          id="search-keyword"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onApply(draft.trim())
          }}
          placeholder="e.g. machine learning"
        />
        <Button type="button" size="sm" onClick={() => onApply(draft.trim())}>
          Apply
        </Button>
      </div>
      {initial && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onApply('')}
        >
          Clear keyword filter
        </Button>
      )}
    </div>
  )
}

export function SearchPage() {
  const { profile, loading, getIdToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') ?? ''
  const rawPage = Number(params.get('page') ?? 1)
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1000 ? rawPage : 1
  const mode = params.get('mode') === 'semantic' ? 'semantic' : 'keyword'
  const requestedSort = params.get('sort')
  const sort: SearchSort = isSearchSort(requestedSort)
    ? requestedSort
    : q
      ? 'relevance'
      : 'newest'
  // Exact author-keyword filter (ranking-neutral). Threaded through every
  // navigation so paging and sorting never silently drop it.
  const keywordFilter = params.get('keyword') ?? ''
  const keepKeyword: Record<string, string> = keywordFilter
    ? { keyword: keywordFilter }
    : {}
  const manager =
    profile?.role === 'ADMIN' || profile?.role === 'REPOSITORY_MANAGER'
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: { q },
  })
  const formQuery = useWatch({ control: form.control, name: 'q' })
  const client = useQueryClient()
  const semantic = useQuery({
    queryKey: ['semantic-search', profile?.id, profile?.role, q, page],
    enabled:
      mode === 'semantic' &&
      Boolean(profile) &&
      q.length <= 200 &&
      q.length > 0,
    retry: false,
    queryFn: async () =>
      apiFetch<SemanticResult>(
        `/api/search/semantic?${new URLSearchParams({ q, page: String(page) })}`,
        await getIdToken(),
      ),
  })
  // Semantic mode falls back to keyword whenever it could not run: unconfigured,
  // quota exhausted, or a provider error. Never fail closed to an empty screen.
  const semanticUnavailable =
    mode === 'semantic' &&
    !semantic.isError &&
    semantic.data !== undefined &&
    semantic.data.semanticStatus !== 'ready'
  const keyword = useQuery({
    queryKey: [
      'keyword-search',
      profile?.id,
      profile?.role,
      q,
      page,
      sort,
      keywordFilter,
    ],
    // Enabled in keyword mode, and also once semantic has reported a downgrade:
    // the fallback query can only start AFTER the semantic answer arrives.
    enabled: (mode === 'keyword' || semanticUnavailable) && q.length <= 200,
    retry: false,
    queryFn: async () =>
      apiFetch<KeywordResult>(
        `/api/search/records?${new URLSearchParams({ q, page: String(page), sort, ...keepKeyword })}`,
        await getIdToken(),
      ),
  })
  const embed = useMutation({
    mutationFn: async () =>
      apiFetch<{ embedded: number; papers: number; hasMore: boolean }>(
        '/api/search/semantic/prepare',
        await getIdToken(),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['semantic-search'] })
    },
  })

  const results = semanticUnavailable
    ? keyword
    : mode === 'semantic'
      ? semantic
      : keyword
  const items = results.data?.items ?? []
  const notice =
    mode === 'semantic' && semantic.data
      ? SEMANTIC_NOTICE[semantic.data.semanticStatus]
      : undefined

  if (loading) return <p>Checking permissions…</p>

  // Keep the entry point visible to public visitors, but do not even issue a
  // semantic API request until the server-backed UA profile exists.
  if (mode === 'semantic' && !profile) {
    const query = q ? `?q=${encodeURIComponent(q)}` : ''
    return <Navigate to={`/search/semantic-access${query}`} replace />
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-[var(--border)] pb-7">
        <p className="eyebrow text-[var(--impact)]">UA research repository</p>
        <div className="mt-3 flex items-start gap-3">
          <BookOpen
            className="mt-1 size-7 shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
          <div>
            <h1 className="display-heading text-4xl font-semibold">
              {mode === 'semantic'
                ? 'Semantic search'
                : 'Find accepted research'}
            </h1>
            <p className="mt-3 max-w-2xl leading-7 text-[var(--ink-muted)]">
              {mode === 'semantic'
                ? 'Search accepted, embedded papers by meaning. Availability and limits are reported after a query runs.'
                : 'Search accepted papers by title, author, year, course, keywords, and prepared full text.'}
            </p>
          </div>
        </div>
      </header>
      <div className="space-y-6">
        {manager && (
          <div className="border-t-2 border-[var(--archive-gold)] bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <SlidersHorizontal
                className="mt-0.5 size-5 text-[var(--primary)]"
                aria-hidden="true"
              />
              <div>
                <h2 className="font-semibold">Semantic index maintenance</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                  Prepare a bounded batch of accepted papers for semantic
                  search.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Button
                variant="outline"
                disabled={embed.isPending}
                onClick={() => embed.mutate()}
              >
                {embed.isPending
                  ? 'Embedding…'
                  : 'Embed papers for semantic search'}
              </Button>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
                Sends one bounded batch of up to 2 papers (20 chunks) to Gemini.
                Wait at least 30 seconds between batches. Counts against the
                daily embedding limit. Papers are embedded once per extraction.
              </p>
              {embed.isSuccess && (
                <p role="status">
                  Embedded {embed.data.embedded} chunks from {embed.data.papers}{' '}
                  papers.
                  {embed.data.hasMore ? ' More remain; run another batch.' : ''}
                </p>
              )}
              {embed.isError && (
                <p role="alert">
                  {embed.error instanceof ApiError
                    ? embed.error.message
                    : 'Could not embed papers.'}
                </p>
              )}
            </div>
          </div>
        )}
        <form
          className="space-y-2"
          onSubmit={form.handleSubmit((values) =>
            setParams(
              mode === 'semantic'
                ? { q: values.q, page: '1', mode: 'semantic' }
                : { q: values.q, page: '1', sort, ...keepKeyword },
            ),
          )}
        >
          <Label className="text-base font-semibold" htmlFor="search-query">
            Keywords, study title, or author
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Input
                id="search-query"
                className="h-12 pr-10 text-base"
                placeholder="e.g. reading comprehension, climate change, or public health"
                {...form.register('q')}
              />
              {formQuery && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
                  aria-label="Clear search"
                  onClick={() => {
                    form.setValue('q', '')
                    setParams({ page: '1', sort: 'newest' })
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
            <Button type="submit" size="lg" className="h-12 px-6">
              <Search className="size-4" aria-hidden="true" />
              Search
            </Button>
          </div>
          {form.formState.errors.q && (
            <p role="alert">{form.formState.errors.q.message}</p>
          )}
          {q.length > 200 && (
            <p role="alert">
              The URL query is too long. Enter at most 200 characters.
            </p>
          )}
          <p className="text-sm leading-6 text-[var(--ink-muted)]">
            {mode === 'semantic'
              ? 'Describe the research you are looking for in your own words.'
              : 'Try a topic, study title, or author. Leave blank to browse accepted papers; quoted phrases are supported.'}
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant={mode === 'keyword' ? 'default' : 'outline'}
              onClick={() => setParams({ q, page: '1', sort, ...keepKeyword })}
            >
              Keyword
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'semantic' ? 'default' : 'outline'}
              onClick={() => {
                if (!profile) {
                  const query = q ? `?q=${encodeURIComponent(q)}` : ''
                  navigate(`/search/semantic-access${query}`)
                  return
                }
                setParams({ q, page: '1', mode: 'semantic' })
              }}
            >
              Semantic
            </Button>
          </div>
          {mode === 'keyword' && (
            <div className="flex flex-wrap items-end gap-4 border-t border-[var(--border)] pt-5">
              <div className="space-y-2">
                <Label htmlFor="search-sort">Sort papers</Label>
                <Select
                  value={sort}
                  onValueChange={(value) =>
                    setParams({
                      q,
                      page: '1',
                      sort: value as SearchSort,
                      ...keepKeyword,
                    })
                  }
                  items={SORT_OPTIONS.map((option) => ({ ...option }))}
                >
                  <SelectTrigger id="search-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <KeywordFilter
                initial={keywordFilter}
                onApply={(next) =>
                  setParams(
                    next
                      ? { q, page: '1', sort, keyword: next }
                      : { q, page: '1', sort },
                  )
                }
              />
            </div>
          )}
        </form>
        {notice && (
          <p
            role="status"
            className="border-l-2 border-[var(--archive-gold)] bg-white px-4 py-3 text-sm leading-6 text-[var(--ink-muted)]"
          >
            {notice}
          </p>
        )}
        {results.isFetching && (
          <p role="status" className="text-sm text-[var(--ink-muted)]">
            Searching…
          </p>
        )}
        {results.isError && (
          <p role="alert">
            {results.error instanceof ApiError
              ? results.error.message
              : 'Search failed.'}
          </p>
        )}
        {!results.isError && q.length <= 200 && results.data && (
          <>
            {items.length === 0 && (
              <p className="border-t border-[var(--border)] pt-5 text-[var(--ink-muted)]">
                {mode === 'semantic'
                  ? 'No close match. Try fewer or more general words, or switch to Keyword search for exact terms.'
                  : 'No matching accepted papers. Full-text matches become available after extraction and search preparation.'}
              </p>
            )}
            <ul className="space-y-4">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="space-y-3 border-t-2 border-[var(--primary)] bg-white p-5 sm:p-6"
                >
                  <h2 className="display-heading text-2xl font-semibold leading-tight">
                    {manager || item.visibility !== 'RESTRICTED' ? (
                      <Link
                        className="transition-colors hover:text-[var(--signal-blue)] hover:underline underline-offset-4"
                        to={`/records/${encodeURIComponent(item.id)}`}
                      >
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </h2>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {mode === 'keyword' && (
                      <>
                        {item.fullTextStatus === 'READY'
                          ? 'Full text searchable'
                          : item.fullTextStatus === 'FAILED'
                            ? 'Full-text processing failed — metadata only'
                            : 'Full text pending — metadata only'}
                        {' · '}
                      </>
                    )}
                    {item.visibility === 'PUBLIC'
                      ? 'Public'
                      : item.visibility === 'UA_ONLY'
                        ? 'University access only'
                        : 'Repository managers only'}
                  </p>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {item.authors || 'Authors not listed'} ·{' '}
                    {item.year || 'Year not listed'}
                  </p>
                  {(item.schoolName || item.courseName) && (
                    <p className="text-sm text-[var(--ink-muted)]">
                      {item.schoolName || 'School not listed'} ·{' '}
                      {item.courseName || 'Course not listed'}
                    </p>
                  )}
                  {(item.keywords ?? []).length > 0 && (
                    <>
                      <span className="sr-only">
                        Keywords: {(item.keywords ?? []).join('; ')}
                      </span>
                      <div
                        className="flex flex-wrap gap-2"
                        aria-label={`Keywords: ${(item.keywords ?? []).join('; ')}`}
                      >
                        {(item.keywords ?? []).map((keyword) => (
                          <span
                            key={keyword}
                            className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  {/* Extracted text is untrusted: React text rendering only, never HTML. */}
                  {item.fullTextStatus === 'READY' && item.snippet && (
                    <p className="whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-4 text-sm leading-6 text-[var(--ink-muted)]">
                      {item.snippet}
                    </p>
                  )}
                  {manager || item.visibility !== 'RESTRICTED' ? (
                    <Link
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                      })}
                      to={`/records/${encodeURIComponent(item.id)}`}
                    >
                      Read paper details
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--ink-muted)]">
                      Details unavailable for your access level
                    </span>
                  )}
                  <Link
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                    to={`/graph?record=${encodeURIComponent(item.id)}`}
                  >
                    <Network className="size-4" aria-hidden="true" />
                    View relationships
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3 border-t border-[var(--border)] pt-5">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() =>
                  setParams(
                    mode === 'semantic'
                      ? { q, page: String(page - 1), mode: 'semantic' }
                      : { q, page: String(page - 1), sort, ...keepKeyword },
                  )
                }
              >
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="outline"
                disabled={!results.data.hasMore || page >= 1000}
                onClick={() =>
                  setParams(
                    mode === 'semantic'
                      ? { q, page: String(page + 1), mode: 'semantic' }
                      : { q, page: String(page + 1), sort, ...keepKeyword },
                  )
                }
              >
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
