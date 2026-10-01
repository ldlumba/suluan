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
interface SearchResult {
  items: {
    id: string
    title: string
    authors: string | null
    year: string | null
    snippet: string | null
    fullTextStatus: 'READY' | 'PENDING' | 'FAILED'
    visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
  }[]
  page: number
  hasMore: boolean
}

export function SearchPage() {
  const { profile, loading, getIdToken } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const rawPage = Number(params.get('page') ?? 1)
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 1000 ? rawPage : 1
  const manager =
    profile?.role === 'ADMIN' || profile?.role === 'REPOSITORY_MANAGER'
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: { q },
  })
  const client = useQueryClient()
  const results = useQuery({
    queryKey: ['keyword-search', profile?.id, profile?.role, q, page],
    enabled: q.length <= 200,
    retry: false,
    queryFn: async () =>
      apiFetch<SearchResult>(
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
          </div>
        )}
        <form
          className="space-y-2"
          onSubmit={form.handleSubmit((values) =>
            setParams({ q: values.q, page: '1' }),
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
            Leave blank to browse accepted papers. Quoted phrases are supported;
            matching is word-based.
          </p>
        </form>
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
            {results.data.items.length === 0 && (
              <p>
                No matching accepted papers. Try other keywords. Full-text matches
                become available after extraction and search preparation.
              </p>
            )}
            <ul className="space-y-4">
              {results.data.items.map((item) => (
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
                onClick={() => setParams({ q, page: String(page - 1) })}
              >
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="outline"
                disabled={!results.data.hasMore || page >= 1000}
                onClick={() => setParams({ q, page: String(page + 1) })}
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
