import {
  ArrowDownToLine,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Network,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  citationCopyCount?: number
}

export function PaperPage() {
  const { id } = useParams<{ id: string }>()
  return <PaperDetail key={id} />
}

function PaperDetail() {
  const { id } = useParams<{ id: string }>()
  const { getIdToken, user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [readerUrl, setReaderUrl] = useState<string | null>(null)
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerError, setReaderError] = useState('')
  const [readerLoading, setReaderLoading] = useState(false)
  const readerGeneration = useRef(0)
  useEffect(
    () => () => {
      readerGeneration.current += 1
    },
    [id],
  )
  useEffect(
    () => () => {
      if (readerUrl) URL.revokeObjectURL(readerUrl)
    },
    [readerUrl],
  )
  const paper = useQuery({
    queryKey: ['paper', id, user?.uid ?? null],
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

  async function openReader() {
    if (!id || readerLoading) return
    setReaderOpen(true)
    setReaderError('')
    setReaderLoading(true)
    const generation = readerGeneration.current
    try {
      const file = await apiDownload(
        `/api/records/${id}/download`,
        await getIdToken(),
      )
      if (generation !== readerGeneration.current) return
      if (file.blob.type.split(';')[0].toLowerCase() !== 'application/pdf') {
        setReaderError(
          'This file cannot be read here. Please download it instead.',
        )
        return
      }
      setReaderUrl(URL.createObjectURL(file.blob))
    } catch {
      if (generation === readerGeneration.current)
        setReaderError('The paper could not be opened. Please try again.')
    } finally {
      if (generation === readerGeneration.current) setReaderLoading(false)
    }
  }

  function closeReader() {
    readerGeneration.current += 1
    setReaderOpen(false)
    setReaderLoading(false)
    setReaderUrl(null)
    setReaderError('')
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
          <CiteSection
            record={{
              title: paper.data.title,
              authors: paper.data.authorList,
              year: paper.data.year,
            }}
            publication={paper.data.publication}
            citationCopyCount={paper.data.citationCopyCount}
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
                })
                  .then(() =>
                    queryClient.invalidateQueries({ queryKey: ['paper', id] }),
                  )
                  .catch(() => undefined)
              })
            }}
          />
          {paper.data.keywords.length > 0 && (
            <section>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                Author keywords
              </h2>
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
            </section>
          )}
        </div>
        <aside className="order-first space-y-4 md:order-none">
          <Button
            variant="outline"
            className="h-12 w-full justify-center gap-2 text-base"
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
              <BookmarkCheck className="size-5" aria-hidden="true" />
            ) : (
              <Bookmark className="size-5" aria-hidden="true" />
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
            variant="outline"
            className="h-12 w-full justify-center gap-2 text-base"
            disabled={readerLoading}
            onClick={() => void openReader()}
          >
            {readerLoading ? 'Opening paper…' : 'Read paper'}
          </Button>
          <Button
            className="h-12 w-full justify-center gap-2 bg-[var(--primary)] text-base hover:bg-[var(--accent)]"
            onClick={() => void download()}
          >
            <ArrowDownToLine className="size-5" aria-hidden="true" /> Download
            paper
          </Button>
          <Link
            className={buttonVariants({
              variant: 'outline',
              className: 'h-12 w-full justify-center gap-2 text-base',
            })}
            to={`/graph?record=${encodeURIComponent(paper.data.id)}`}
          >
            <Network className="size-5" aria-hidden="true" /> View relationships
          </Link>
        </aside>
      </div>
      <Dialog
        open={readerOpen}
        onOpenChange={(open) => {
          if (!open) closeReader()
        }}
      >
        <DialogContent className="flex h-[90dvh] max-h-[90dvh] flex-col sm:max-w-5xl">
          <DialogHeader className="pr-10">
            <DialogTitle>Read paper</DialogTitle>
            <DialogDescription>
              {paper.data.title}. If the document does not display, download it
              to read it.
            </DialogDescription>
          </DialogHeader>
          {readerLoading && <p role="status">Opening paper…</p>}
          {readerError && (
            <p role="alert" className="text-[var(--impact-red)]">
              {readerError}
            </p>
          )}
          {readerUrl && (
            <iframe
              title="Paper PDF viewer"
              src={readerUrl}
              className="min-h-0 w-full flex-1 border"
            />
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={closeReader}>
              Close reader
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  )
}
