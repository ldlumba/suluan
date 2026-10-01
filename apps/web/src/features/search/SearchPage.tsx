import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { Search } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

const formSchema = z.object({
  q: z.string().trim().max(200, 'Use at most 200 characters.'),
})
interface SearchItem {
  id: string
  title: string
  authors: string | null
  year: string | null
  snippet: string | null
  fullTextStatus: 'READY' | 'PENDING' | 'FAILED'
  visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
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
}

export function SearchPage() {
  const { profile, loading, getIdToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const rawPage = Number(params.get('page') ?? 1)
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1000 ? rawPage : 1
  const mode = params.get('mode') === 'semantic' ? 'semantic' : 'keyword'
  const manager =
    profile?.role === 'ADMIN' || profile?.role === 'REPOSITORY_MANAGER'
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: { q },
  })
  const client = useQueryClient()
  const semantic = useQuery({
    queryKey: ['semantic-search', profile?.id, profile?.role, q, page],
    enabled: mode === 'semantic' && q.length <= 200 && q.length > 0,
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
    queryKey: ['keyword-search', profile?.id, profile?.role, q, page],
    // Enabled in keyword mode, and also once semantic has reported a downgrade:
    // the fallback query can only start AFTER the semantic answer arrives.
    enabled: (mode === 'keyword' || semanticUnavailable) && q.length <= 200,
    retry: false,
    queryFn: async () =>
      apiFetch<KeywordResult>(
        `/api/search/records?${new URLSearchParams({ q, page: String(page) })}`,
        await getIdToken(),
      ),
  })
  const prepare = useMutation({
    mutationFn: async () =>
      apiFetch<{ indexed: number; hasMore: boolean }>(
        '/api/search/index',
        await getIdToken(),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['keyword-search'] })
    },
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

  const results = semanticUnavailable ? keyword : mode === 'semantic' ? semantic : keyword
  const items = results.data?.items ?? []
  const notice =
    mode === 'semantic' && semantic.data
      ? SEMANTIC_NOTICE[semantic.data.semanticStatus]
      : undefined

  if (loading) return <p>Checking permissions…</p>

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold">Keyword search</h1>
        <CardDescription>
          Accepted papers, searchable by title, author, year, and full text.
          Semantic search is not enabled yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {manager && (
          <div className="space-y-2">
          <Button
            variant="outline"
            disabled={prepare.isPending}
            onClick={() => prepare.mutate()}
          >
            {prepare.isPending
              ? 'Preparing…'
              : 'Prepare extracted papers for search'}
          </Button>
          <p className="text-sm text-muted-foreground">
            Prepares up to 10 papers per batch. Queued extraction jobs are left
            alone.
          </p>
          {prepare.isSuccess && (
            <p role="status">
              Prepared {prepare.data.indexed} papers.
              {prepare.data.hasMore
                ? ' More remain; run another batch.'
                : ' Batch complete.'}
            </p>
          )}
          {prepare.isError && (
            <p role="alert">
              {prepare.error instanceof ApiError
                ? prepare.error.message
                : 'Could not prepare papers.'}
            </p>
          )}
          <div className="border-t pt-4">
            <Button
              variant="outline"
              disabled={embed.isPending}
              onClick={() => embed.mutate()}
            >
              {embed.isPending
                ? 'Embedding…'
                : 'Embed papers for semantic search'}
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">
              Sends up to 2 papers (100 chunks) per batch to Gemini. Counts
              against the daily embedding limit. Papers are embedded once per
              extraction.
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
                : { q: values.q, page: '1' },
            ),
          )}
        >
          <Label htmlFor="search-query">Keywords, study title, or author</Label>
          <div className="flex gap-2">
            <Input id="search-query" {...form.register('q')} />
            <Button type="submit">
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
          <p className="text-sm text-muted-foreground">
            {mode === 'semantic'
              ? 'Describe the research you are looking for in your own words.'
              : 'Leave blank to browse accepted papers. Quoted phrases are supported; matching is word-based.'}
          </p>
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant={mode === 'keyword' ? 'default' : 'outline'}
              onClick={() => setParams({ q, page: '1' })}
            >
              Keyword
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'semantic' ? 'default' : 'outline'}
              onClick={() => setParams({ q, page: '1', mode: 'semantic' })}
            >
              Semantic
            </Button>
          </div>
        </form>
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {results.isFetching && <p role="status">Searching…</p>}
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
              <p>
                No matching accepted papers.{' '}
                {mode === 'semantic'
                  ? 'Papers appear here once they have been extracted, keyword-prepared, and embedded.'
                  : 'Full-text matches become available after extraction and search preparation.'}
              </p>
            )}
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={item.id} className="space-y-2 rounded-lg border p-4">
                  <h2 className="font-semibold">{item.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {item.fullTextStatus === 'READY'
                      ? 'Full text searchable'
                      : item.fullTextStatus === 'FAILED'
                        ? 'Full-text processing failed — metadata only'
                        : 'Full text pending — metadata only'}
                    {' · '}
                    {item.visibility === 'PUBLIC'
                      ? 'Public'
                      : item.visibility === 'UA_ONLY'
                        ? 'University access only'
                        : 'Repository managers only'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.authors || 'Authors not listed'} ·{' '}
                    {item.year || 'Year not listed'}
                  </p>
                  {/* Extracted text is untrusted: React text rendering only, never HTML. */}
                  {item.fullTextStatus === 'READY' && item.snippet && (
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {item.snippet}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() =>
                  setParams(
                    mode === 'semantic'
                      ? { q, page: String(page - 1), mode: 'semantic' }
                      : { q, page: String(page - 1) },
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
                      : { q, page: String(page + 1) },
                  )
                }
              >
                Next
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
