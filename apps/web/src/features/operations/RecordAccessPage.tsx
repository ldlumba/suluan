import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { KeywordInput } from '@/features/submissions/KeywordInput'

type Visibility = 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
interface Paper {
  id: string
  title: string
  year: number
  visibility: Visibility
  effectiveVisibility: Visibility
  embargoUntil: string | null
  updatedAt: string
  schoolName: string | null
  courseName: string | null
  keywords: string[]
}
interface School {
  id: string
  name: string
  courses: { id: string; name: string }[]
}
const labels: Record<Visibility, string> = {
  PUBLIC: 'Public',
  UA_ONLY: 'University access',
  RESTRICTED: 'Managers only',
}
const accessColors: Record<Visibility, string> = {
  PUBLIC: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  UA_ONLY: 'border-blue-300 bg-blue-50 text-blue-900',
  RESTRICTED: 'border-amber-300 bg-amber-50 text-amber-950',
}

export function RecordAccessPage() {
  const { getIdToken, profile } = useAuth()
  const client = useQueryClient()
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [schoolId, setSchoolId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState('title')
  const [editing, setEditing] = useState<Paper | null>(null)
  const [keywordPaper, setKeywordPaper] = useState<Paper | null>(null)
  const [keywords, setKeywords] = useState<string[]>([])
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC')
  const [embargo, setEmbargo] = useState('')
  const catalog = useQuery({
    queryKey: ['schools'],
    queryFn: async () => apiFetch<School[]>('/api/schools', await getIdToken()),
  })
  const records = useQuery({
    queryKey: ['record-access', profile?.id, q, schoolId, courseId, sort, page],
    queryFn: async () => {
      const params = new URLSearchParams({ q, sort, page: String(page) })
      if (schoolId) params.set('schoolId', schoolId)
      if (courseId) params.set('courseId', courseId)
      return apiFetch<{ items: Paper[]; hasMore: boolean }>(
        `/api/record-access?${params}`,
        await getIdToken(),
      )
    },
    retry: false,
  })
  const change = useMutation({
    mutationFn: async () =>
      apiFetch(`/api/record-access/${editing!.id}`, await getIdToken(), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visibility,
          embargoUntil: visibility === 'PUBLIC' || !embargo ? null : embargo,
          expectedUpdatedAt: editing!.updatedAt,
        }),
      }),
    onSuccess: () => {
      setEditing(null)
      void client.invalidateQueries({ queryKey: ['record-access'] })
      void client.invalidateQueries({ queryKey: ['search'] })
    },
  })
  const changeKeywords = useMutation({
    mutationFn: async () =>
      apiFetch(
        `/api/record-access/${keywordPaper!.id}/keywords`,
        await getIdToken(),
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            keywords,
            expectedUpdatedAt: keywordPaper!.updatedAt,
          }),
        },
      ),
    onSuccess: () => {
      setKeywordPaper(null)
      void client.invalidateQueries({ queryKey: ['record-access'] })
      void client.invalidateQueries({ queryKey: ['paper'] })
      void client.invalidateQueries({ queryKey: ['keyword-search'] })
      void client.invalidateQueries({ queryKey: ['semantic-search'] })
      void client.invalidateQueries({ queryKey: ['graph'] })
      void client.invalidateQueries({ queryKey: ['graph-counts'] })
    },
  })
  const selectClass =
    'h-9 w-full rounded-md border border-input bg-white px-3 text-sm'
  if (
    [records.error, change.error, changeKeywords.error].some(
      (error) => error instanceof ApiError && error.status === 403,
    )
  )
    return <NotFoundPage />
  return (
    <section className="space-y-6">
      <header className="border-b pb-6">
        <h1 className="display-heading text-4xl font-semibold">
          Repository access review
        </h1>
        <p className="mt-3 text-[var(--ink-muted)]">
          Review accepted papers and change who can access them. Public cached
          results can take up to 30 seconds to update.
        </p>
      </header>
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(draft)
          setPage(1)
        }}
      >
        <div>
          <Label htmlFor="access-sort">Sort by</Label>
          <select
            id="access-sort"
            className={selectClass}
            value={sort}
            onChange={(e) => {
              setSort(e.target.value)
              setPage(1)
            }}
          >
            <option value="title">Title A–Z</option>
            <option value="title_desc">Title Z–A</option>
            <option value="newest">Recently accepted</option>
            <option value="oldest">Oldest accepted</option>
            <option value="program">Program A–Z</option>
            <option value="access">Access level</option>
          </select>
        </div>
        <div>
          <Label htmlFor="access-search">Paper title</Label>
          <Input
            id="access-search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <Label htmlFor="access-school">School</Label>
          <select
            id="access-school"
            className={selectClass}
            value={schoolId}
            onChange={(e) => {
              setSchoolId(e.target.value)
              setCourseId('')
              setPage(1)
            }}
          >
            <option value="">All schools</option>
            {catalog.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="access-program">Program</Label>
          <select
            id="access-program"
            className={selectClass}
            value={courseId}
            disabled={!schoolId}
            onChange={(e) => {
              setCourseId(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All programs</option>
            {catalog.data
              ?.find((s) => s.id === schoolId)
              ?.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {catalog.isError && (
        <p role="alert">School and program filters are unavailable.</p>
      )}
      {records.isLoading && <p role="status">Loading accepted papers…</p>}
      {records.isError && (
        <p role="alert">Accepted papers could not be loaded.</p>
      )}
      {records.data?.items.length === 0 && <p>No accepted papers found.</p>}
      <div className="space-y-3">
        {records.data?.items.map((paper) => (
          <article
            key={paper.id}
            className="border-t-2 border-[var(--primary)] bg-white p-5"
          >
            <div className="space-y-4">
              <div>
                <Link
                  to={`/records/${paper.id}`}
                  className="text-lg font-semibold underline"
                >
                  {paper.title}
                </Link>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {paper.year} · {paper.schoolName ?? 'School not listed'} ·{' '}
                  {paper.courseName ?? 'Program not listed'}
                </p>
                <p className="mt-2 text-sm">
                  Current access:{' '}
                  <strong
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${accessColors[paper.effectiveVisibility]}`}
                  >
                    {labels[paper.effectiveVisibility]}
                  </strong>
                  {paper.embargoUntil && (
                    <> · Auto-lift: {paper.embargoUntil}</>
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(paper)
                  setVisibility(paper.visibility)
                  setEmbargo(paper.embargoUntil ?? '')
                  change.reset()
                }}
              >
                Change access
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setKeywordPaper(paper)
                  setKeywords(paper.keywords ?? [])
                  changeKeywords.reset()
                }}
              >
                Edit keywords
              </Button>
            </div>
          </article>
        ))}
      </div>
      <Dialog
        open={keywordPaper !== null}
        onOpenChange={(open) => {
          if (!open && !changeKeywords.isPending) setKeywordPaper(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit author keywords</DialogTitle>
            <DialogDescription>
              {keywordPaper?.title}. Changes are audited and do not replace the
              submission or file.
            </DialogDescription>
          </DialogHeader>
          <KeywordInput
            id="record-keywords"
            value={keywords}
            onChange={setKeywords}
          />
          {changeKeywords.isError && (
            <p role="alert">Could not save keywords. Refresh and try again.</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setKeywordPaper(null)}
              disabled={changeKeywords.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => changeKeywords.mutate()}
              disabled={changeKeywords.isPending}
            >
              Save keywords
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          variant="outline"
          disabled={!records.data?.hasMore}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !change.isPending) setEditing(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change paper access</DialogTitle>
            <DialogDescription>{editing?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="new-access">Access</Label>
            <select
              id="new-access"
              className={selectClass}
              value={visibility}
              onChange={(e) => {
                const v = e.target.value as Visibility
                setVisibility(v)
                if (v === 'PUBLIC') setEmbargo('')
              }}
            >
              <option value="PUBLIC">Public — anyone</option>
              <option value="UA_ONLY">
                University access — sign-in required
              </option>
              <option value="RESTRICTED">Restricted — managers only</option>
            </select>
            {visibility !== 'PUBLIC' && (
              <div>
                <Label htmlFor="access-embargo">
                  Auto-lift date (optional)
                </Label>
                <Input
                  id="access-embargo"
                  type="date"
                  value={embargo}
                  onChange={(e) => setEmbargo(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  On this date the paper becomes public automatically. Leave
                  blank for an indefinite restriction.
                </p>
              </div>
            )}
            {change.isError && (
              <p role="alert">
                Could not save access. The paper may have changed; close this
                dialog and refresh the page.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={change.isPending}
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button disabled={change.isPending} onClick={() => change.mutate()}>
              {change.isPending ? 'Saving…' : 'Save access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
