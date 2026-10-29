import {
  ArrowDownToLine,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Network,
  ShieldCheck,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { CiteSection } from '@/features/citations/CiteSection'
import { apiDownload, apiFetch, ApiError } from '@/lib/api'
import { useAuth } from '@/features/auth/useAuth'

interface Paper {
  id: string
  title: string
  authors: string | null
  authorList: string[]
  publication: {
    doi: string
    venue: string | null
    volume: string | null
    issue: string | null
    pages: string | null
    year: string | null
  } | null
  schoolName: string | null
  courseName: string | null
  year: string | null
  visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
  fullTextStatus: 'READY' | 'PENDING' | 'FAILED'
  keywords: string[]
}

const visibilityLabels = {
  PUBLIC: 'Publicly accessible',
  UA_ONLY: 'University access only',
  RESTRICTED: 'Repository managers only',
}

export function PaperPage() {
  const { id } = useParams<{ id: string }>()
  const { getIdToken, user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const paper = useQuery({
    queryKey: ['paper', id],
    enabled: Boolean(id),
    retry: false,
    queryFn: async () =>
      apiFetch<Paper>(`/api/records/${id}`, await getIdToken()),
  })
  const bookmark = useQuery({
    queryKey: ['bookmark', id],
    enabled: Boolean(id && user),
    retry: false,
    queryFn: async () =>
      apiFetch<{ bookmarked: boolean }>(
        `/api/bookmarks/${id}`,
        await getIdToken(),
      ),
  })
  const bookmarkMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing record id')
      const bookmarked = bookmark.data?.bookmarked ?? false
      return apiFetch<{ bookmarked: boolean }>(
        `/api/bookmarks/${id}`,
        await getIdToken(),
        { method: bookmarked ? 'DELETE' : 'POST' },
      )
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['bookmark', id], result)
      void queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })

  useEffect(() => {
    if (!user || !paper.data || !id) return
    void getIdToken().then((token) => {
      if (!token) return
      return apiFetch('/api/activity', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: id, eventType: 'PAPER_VIEW' }),
      }).catch(() => undefined)
    })
  }, [getIdToken, id, paper.data, user])

  async function download() {
    if (!id) return
    const file = await apiDownload(
      `/api/records/${id}/download`,
      await getIdToken(),
    )
    const url = URL.createObjectURL(file.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.fileName
    anchor.click()
    URL.revokeObjectURL(url)
    if (user) {
      void getIdToken().then((token) => {
        if (!token) return
        return apiFetch('/api/activity', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: id, eventType: 'DOWNLOAD_START' }),
        }).catch(() => undefined)
      })
    }
  }

  if (paper.isPending) return <p role="status">Loading paper…</p>
  if (paper.isError) {
    const notFound =
      paper.error instanceof ApiError && paper.error.status === 404
    return (
      <div className="mx-auto max-w-2xl py-12">
        <p className="eyebrow text-[var(--impact)]">
          {notFound ? 'Paper unavailable' : 'Something went wrong'}
        </p>
        <h1 className="display-heading mt-3 text-4xl font-semibold">
          {notFound
            ? 'This paper is not available here.'
            : 'We could not load this paper.'}
        </h1>
        <p className="mt-4 leading-7 text-[var(--ink-muted)]">
          {notFound
            ? 'This record cannot be opened from the current session. It may be restricted, unpublished, or no longer available.'
            : 'Try again, or return to the repository search.'}
        </p>
        <Link
          className={`${buttonVariants({ variant: 'outline' })} mt-8`}
          to="/search"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to search
        </Link>
      </div>
    )
  }
  if (!paper.data) return null

  return (
    <article className="mx-auto max-w-4xl">
      <Link
        to="/search"
        className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:text-[var(--accent)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to repository
      </Link>
      <div className="mt-10 border-b border-[var(--border)] pb-10">
        <p className="eyebrow text-[var(--impact)]">Research record</p>
        <h1 className="display-heading mt-4 max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
          {paper.data.title}
        </h1>
        <p className="mt-6 text-lg leading-8 text-[var(--ink-muted)]">
          {paper.data.authors || 'Authors not listed'}
        </p>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--ink-muted)]">
          {paper.data.year && <span>{paper.data.year}</span>}
          {paper.data.schoolName && <span>{paper.data.schoolName}</span>}
          {paper.data.courseName && <span>{paper.data.courseName}</span>}
        </div>
      </div>
      <div className="grid gap-10 py-10 md:grid-cols-[1fr_16rem]">
        <div>
          <h2 className="display-heading text-2xl font-bold">
            About this record
          </h2>
          <p className="mt-4 max-w-prose leading-8 text-[var(--ink-muted)]">
            This accepted research record is part of the University of the
            Assumption repository. The available metadata is shown here; the
            paper file remains subject to its access policy.
          </p>
          {paper.data.keywords.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                Author keywords
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {paper.data.keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-sm"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside className="space-y-4">
          <div className="rounded-[25px] bg-[var(--secondary)] p-5">
            <ShieldCheck
              className="size-6 text-[var(--primary)]"
              aria-hidden="true"
            />
            <p className="mt-4 text-sm font-semibold">
              {visibilityLabels[paper.data.visibility]}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Access is enforced by the repository, not by this page.
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full justify-center"
            disabled={bookmarkMutation.isPending}
            onClick={() => {
              if (!user) {
                navigate(
                  `/signin?returnTo=${encodeURIComponent(`/records/${id}`)}`,
                )
                return
              }
              bookmarkMutation.mutate()
            }}
          >
            {bookmark.data?.bookmarked ? (
              <BookmarkCheck className="size-4" aria-hidden="true" />
            ) : (
              <Bookmark className="size-4" aria-hidden="true" />
            )}
            {bookmark.data?.bookmarked ? 'Bookmarked' : 'Add bookmark'}
          </Button>
          {bookmarkMutation.isError && (
            <p role="alert" className="text-sm text-[var(--impact-red)]">
              {bookmarkMutation.error instanceof ApiError &&
              bookmarkMutation.error.status === 404
                ? 'Bookmarks are not enabled by the repository service yet.'
                : 'This bookmark could not be updated. Please try again.'}
            </p>
          )}
          <Button
            className="w-full justify-center bg-[var(--primary)] hover:bg-[var(--accent)]"
            onClick={() => void download()}
          >
            <ArrowDownToLine className="size-4" aria-hidden="true" /> Download
            paper
          </Button>
          <Link
            className={`${buttonVariants({ variant: 'outline' })} w-full justify-center`}
            to={`/graph?record=${encodeURIComponent(paper.data.id)}`}
          >
            <Network className="size-4" aria-hidden="true" /> View relationships
          </Link>
        </aside>
      </div>
      <CiteSection
        record={{
          title: paper.data.title,
          authors: paper.data.authorList,
          year: paper.data.year,
        }}
        publication={paper.data.publication}
        onCitationCopied={() => {
          if (!user || !id) return
          void getIdToken().then((token) => {
            if (!token) return
            return apiFetch('/api/activity', token, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recordId: id,
                eventType: 'CITATION_COPY',
              }),
            }).catch(() => undefined)
          })
        }}
      />
    </article>
  )
}
