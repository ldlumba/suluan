import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { CheckCircle2, FileUp, UploadCloud, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/api'
import { useAuth } from '@/features/auth/useAuth'
import { KeywordInput } from './KeywordInput'
import { submissionFormSchema, type SubmissionFormInput } from './schema'

interface School {
  id: string
  name: string
  courses: { id: string; name: string }[]
}

type Phase = 'editing' | 'uploading' | 'success'

const FRIENDLY_ERRORS: Record<string, string> = {
  unsupported_file_type: 'The document type is not accepted.',
  filename_type_mismatch: 'The file name does not match its document type.',
  file_too_large: 'The file exceeds the server upload limit.',
  empty_file: 'The selected file is empty.',
  missing_file: 'A PDF document is required.',
  invalid_fields: 'Check the title, school, and program and try again.',
  invalid_access: 'Select a valid access level and a future auto-lift date.',
  invalid_keywords: 'Use at most 5 keywords, each under 100 characters.',
  invalid_form: 'The submission could not be read. Please try again.',
  storage_unavailable:
    'File storage is temporarily unavailable. Please try again in a moment.',
  unknown_school: 'The selected school is no longer available.',
  unknown_course: 'The selected program is no longer available.',
  course_inactive:
    'The selected program is no longer open for new submissions. Choose another program.',
  duplicate_pending:
    'You already have a paper with this title awaiting review. Check My submissions before sending it again.',
  course_school_mismatch:
    'The selected program does not belong to the selected school.',
}

export function NewSubmissionPage({ direct = false }: { direct?: boolean }) {
  const { user, loading, getIdToken } = useAuth()
  const [phase, setPhase] = useState<Phase>('editing')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [publicMatches, setPublicMatches] = useState<
    { recordId: string; title: string; year: string | null }[]
  >([])
  const [isDragging, setIsDragging] = useState(false)
  const [programHint, setProgramHint] = useState(false)
  const [visibility, setVisibility] = useState<
    'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
  >('RESTRICTED')
  const [embargo, setEmbargo] = useState('')
  const [confirmDirect, setConfirmDirect] = useState(false)
  const programHintRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // One idempotency key per form attempt: retries reuse it.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const form = useForm<SubmissionFormInput>({
    resolver: zodResolver(submissionFormSchema),
    defaultValues: {
      title: '',
      authors: '',
      schoolId: '',
      courseId: '',
      keywords: [],
    },
  })
  const selectedSchoolId = useWatch({ control: form.control, name: 'schoolId' })
  const selectedCourseId = useWatch({ control: form.control, name: 'courseId' })
  const selectedFile = useWatch({ control: form.control, name: 'file' })

  const schoolsQuery = useQuery({
    queryKey: ['schools'],
    queryFn: async () => {
      const token = await getIdToken()
      return apiFetch<School[]>('/api/schools', token)
    },
    enabled: user !== null,
  })
  const schools = useMemo(() => schoolsQuery.data ?? [], [schoolsQuery.data])
  const courses = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId)?.courses ?? [],
    [schools, selectedSchoolId],
  )

  useEffect(() => {
    if (
      selectedCourseId &&
      !courses.some((course) => course.id === selectedCourseId)
    ) {
      form.setValue('courseId', '')
    }
  }, [courses, form, selectedCourseId])

  useEffect(() => {
    if (!programHint) return
    const timer = window.setTimeout(() => setProgramHint(false), 6000)
    const dismiss = (event: PointerEvent) => {
      if (!programHintRef.current?.contains(event.target as Node))
        setProgramHint(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProgramHint(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [programHint])

  if (loading)
    return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
  if (!user) {
    return (
      <div className="border-t-2 border-[var(--primary)] bg-white p-6 text-sm">
        <p className="font-semibold">Sign in to submit research.</p>
        <p className="mt-2 leading-6 text-[var(--ink-muted)]">
          <Link to="/signin" className="underline underline-offset-4">
            Sign in
          </Link>{' '}
          with your UA Google account to submit research.
        </p>
      </div>
    )
  }

  if (phase === 'success') {
    return (
      <div className="border-t-2 border-[var(--signal-blue)] bg-white p-6 sm:p-8">
        <CheckCircle2
          className="size-9 text-[var(--signal-blue)]"
          aria-hidden="true"
        />
        <h1 className="display-heading mt-5 text-4xl font-semibold">
          {direct ? 'Paper accepted' : 'Submission received'}
        </h1>
        <p className="mt-3 max-w-xl leading-7 text-[var(--ink-muted)]">
          {direct
            ? 'The paper has been accepted and queued for preparation. No notification email was sent.'
            : 'Your paper is pending REO review. You will be notified of the decision by email.'}
        </p>
        <div className="mt-7">
          <Link
            to="/submissions"
            className={buttonVariants({ variant: 'outline' })}
          >
            View my submissions
          </Link>
        </div>
      </div>
    )
  }

  async function onSubmit(
    values: SubmissionFormInput,
    acknowledgeDuplicate = false,
  ) {
    setSubmitError(null)
    setDuplicateWarning(null)
    setPublicMatches([])
    setPhase('uploading')
    try {
      const token = await getIdToken()
      if (!token) throw new ApiError(401, 'Signed out or session expired.')

      // Single Worker-proxied request: file + metadata as multipart/form-data.
      // The Worker streams the file into private R2, so the browser never
      // needs bucket access or CORS. No content-type header — the browser
      // sets the multipart boundary itself.
      const form = new FormData()
      form.append('file', values.file)
      form.append('idempotencyKey', idempotencyKey)
      form.append('title', values.title)
      if (values.authors) form.append('authors', values.authors)
      form.append('schoolId', values.schoolId)
      form.append('courseId', values.courseId)
      if (direct) {
        form.append('visibility', visibility)
        if (visibility !== 'PUBLIC' && embargo)
          form.append('embargoUntil', embargo)
      }
      if (acknowledgeDuplicate) form.append('duplicateAcknowledged', 'true')
      for (const term of values.keywords ?? []) form.append('keywords[]', term)

      const created = await apiFetch<{ id: string; status: string }>(
        direct ? '/api/submissions/direct' : '/api/submissions',
        token,
        { method: 'POST', body: form },
      )
      setSubmissionId(created.id)
      setPhase('success')
    } catch (err) {
      setPhase('editing')
      if (err instanceof ApiError && err.code === 'possible_duplicate') {
        setDuplicateWarning(err.message)
        const matches =
          (err.details.publicMatches as
            | { recordId: string; title: string; year: string | null }[]
            | undefined) ?? []
        setPublicMatches(
          Array.isArray(matches)
            ? matches.filter((m) => m && typeof m.recordId === 'string')
            : [],
        )
      } else if (
        err instanceof ApiError &&
        err.code &&
        FRIENDLY_ERRORS[err.code]
      ) {
        setSubmitError(FRIENDLY_ERRORS[err.code])
      } else if (err instanceof ApiError) {
        setSubmitError(err.message)
      } else {
        setSubmitError(
          'The submission could not be completed. Please try again.',
        )
      }
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="border-t-2 border-[var(--primary)] bg-white p-5 sm:p-7">
        <div className="mb-7 flex items-start gap-3 border-b border-[var(--border)] pb-6">
          <UploadCloud
            className="mt-1 size-7 shrink-0 text-[var(--primary)]"
            aria-hidden="true"
          />
          <div>
            <p className="eyebrow text-[var(--impact)]">Research intake</p>
            <h1 className="display-heading mt-2 text-4xl font-semibold">
              {direct ? 'Direct upload' : 'Submit research'}
            </h1>
            <p className="mt-3 max-w-xl leading-7 text-[var(--ink-muted)]">
              {direct
                ? 'This paper will be accepted immediately with the selected access. No emails will be sent.'
                : 'Your paper goes to REO review first. Nothing is published until it is accepted.'}
            </p>
          </div>
        </div>
        <form
          onSubmit={form.handleSubmit((values) =>
            direct ? setConfirmDirect(true) : onSubmit(values),
          )}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              {...form.register('title', {
                onChange: () => {
                  setDuplicateWarning(null)
                  setPublicMatches([])
                },
              })}
            />
            {form.formState.errors.title && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="authors">Authors</Label>
            <Textarea
              id="authors"
              placeholder={'Dela Cruz, Juan A.\nSantos, Maria C.'}
              {...form.register('authors')}
            />
            <p className="text-xs leading-5 text-[var(--ink-muted)]">
              One author per line. Ex. Dela Cruz, Juan A. — family name first,
              then given name and middle initial.
            </p>
          </div>

          <Controller
            control={form.control}
            name="keywords"
            render={({ field }) => (
              <KeywordInput
                id="keywords"
                value={field.value ?? []}
                onChange={field.onChange}
                error={
                  form.formState.errors.keywords?.message as string | undefined
                }
              />
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="submission-school">School</Label>
              <div className="relative">
                <Controller
                  control={form.control}
                  name="schoolId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        setProgramHint(false)
                        field.onChange(value)
                        form.setValue('courseId', '')
                      }}
                      items={schools.map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                    >
                      <SelectTrigger
                        id="submission-school"
                        className={selectedSchoolId ? 'w-full pr-16' : 'w-full'}
                      >
                        <SelectValue placeholder="Select a school" />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {schools.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {selectedSchoolId && (
                  <button
                    type="button"
                    aria-label="Clear school"
                    className="absolute inset-y-0 right-7 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => {
                      form.setValue('schoolId', '')
                      form.setValue('courseId', '')
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {form.formState.errors.schoolId && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.schoolId.message}
                </p>
              )}
            </div>
            <div className="relative space-y-2" ref={programHintRef}>
              <Label htmlFor="submission-program">Program</Label>
              <div className="relative">
                {!selectedSchoolId ? (
                  <button
                    id="submission-program"
                    type="button"
                    aria-disabled="true"
                    aria-describedby={programHint ? 'program-hint' : undefined}
                    onClick={() => setProgramHint(true)}
                    className="flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 text-left text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Select a school first
                  </button>
                ) : (
                  <Controller
                    control={form.control}
                    name="courseId"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={courses.length === 0}
                        items={courses.map((c) => ({
                          value: c.id,
                          label: c.name,
                        }))}
                      >
                        <SelectTrigger
                          id="submission-program"
                          className={
                            selectedCourseId ? 'w-full pr-16' : 'w-full'
                          }
                        >
                          <SelectValue
                            placeholder={
                              courses.length === 0
                                ? 'Select a school first'
                                : 'Select a program'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {courses.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
                {selectedCourseId && (
                  <button
                    type="button"
                    aria-label="Clear program"
                    className="absolute inset-y-0 right-7 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => form.setValue('courseId', '')}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {programHint && !selectedSchoolId && (
                <p
                  id="program-hint"
                  role="status"
                  className="absolute z-10 rounded-md border bg-white p-3 text-sm shadow-md"
                >
                  Select a school first, or choose a program from the catalog on
                  the right.
                </p>
              )}
              {form.formState.errors.courseId && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.courseId.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Document (PDF, up to 15 MB)</Label>
            <div
              onClick={(e) => {
                if (
                  e.target instanceof Element &&
                  e.target.closest('button, input')
                )
                  return
                fileInputRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                const dropped = e.dataTransfer.files?.[0]
                if (dropped)
                  form.setValue('file', dropped, { shouldValidate: true })
              }}
              className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-[8.4px] border-2 border-dashed p-6 text-center transition-colors ${
                isDragging
                  ? 'border-[var(--signal-blue)] bg-[var(--secondary)]'
                  : 'border-[var(--border)] bg-white'
              }`}
            >
              <FileUp
                className="size-8 text-[var(--primary)]"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold">
                  Drag and drop your file here, or choose a file
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                  PDF only, up to 15 MB.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file
                </Button>
                {selectedFile instanceof File && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      form.setValue('file' as never, undefined as never, {
                        shouldValidate: true,
                      })
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </div>
              {selectedFile instanceof File && (
                <p className="text-sm font-medium">
                  {selectedFile.name} {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              )}
              <Input
                ref={fileInputRef}
                id="file"
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const picked = e.target.files?.[0]
                  if (picked)
                    form.setValue('file', picked, { shouldValidate: true })
                }}
              />
            </div>
            {form.formState.errors.file && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.file.message as string}
              </p>
            )}
          </div>

          {direct && (
            <div className="space-y-2">
              <Label htmlFor="direct-visibility">Paper access</Label>
              <select
                id="direct-visibility"
                className="h-10 w-full rounded-md border border-input bg-white px-3"
                value={visibility}
                onChange={(e) => {
                  setVisibility(e.target.value as typeof visibility)
                  setEmbargo('')
                }}
              >
                <option value="RESTRICTED">Managers only</option>
                <option value="UA_ONLY">University access</option>
                <option value="PUBLIC">Public</option>
              </select>
              {visibility !== 'PUBLIC' && (
                <div>
                  <Label htmlFor="direct-embargo">
                    Auto-lift date (optional)
                  </Label>
                  <Input
                    id="direct-embargo"
                    type="date"
                    value={embargo}
                    onChange={(e) => setEmbargo(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Access becomes public on this date. Leave blank to restrict
                    indefinitely.
                  </p>
                </div>
              )}
            </div>
          )}
          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}

          {duplicateWarning && (
            <div
              role="alert"
              className="border border-[var(--archive-gold)] bg-[var(--secondary)] p-4"
            >
              <p className="font-semibold">Possible duplicate title</p>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
                {duplicateWarning} A returned submission does not block a
                corrected resubmission.
              </p>
              {publicMatches.length > 0 && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <p className="text-sm font-semibold">
                    Already-published match
                    {publicMatches.length > 1 ? 'es' : ''}:
                  </p>
                  <ul className="mt-2 space-y-2">
                    {publicMatches.map((match) => (
                      <li key={match.recordId} className="text-sm leading-6">
                        <Link
                          to={`/records/${match.recordId}`}
                          className="font-medium underline underline-offset-4"
                        >
                          {match.title}
                        </Link>
                        {match.year && (
                          <span className="text-[var(--ink-muted)]">
                            {' '}
                            · {match.year}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {publicMatches.length === 0 && (
                <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
                  No public repository copy is shown. Other pending submissions
                  stay private, so compare your title carefully before
                  confirming.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDuplicateWarning(null)
                    setPublicMatches([])
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    void form.handleSubmit((values) => onSubmit(values, true))()
                  }
                >
                  Submit as a different paper
                </Button>
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={phase === 'uploading' || duplicateWarning !== null}
          >
            {phase === 'uploading'
              ? 'Uploading…'
              : direct
                ? 'Upload and accept'
                : 'Submit for review'}
          </Button>
          {submissionId && (
            <p className="text-xs text-muted-foreground">
              Reference: {submissionId}
            </p>
          )}
        </form>
        <Dialog open={confirmDirect} onOpenChange={setConfirmDirect}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Accept this paper?</DialogTitle>
              <DialogDescription>
                This immediately accepts the paper with the selected access. No
                notification email will be sent. Preparation for search happens
                afterward.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setConfirmDirect(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmDirect(false)
                  void form.handleSubmit((values) => onSubmit(values))()
                }}
              >
                Accept and upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <aside className="border-t-2 border-[var(--archive-gold)] bg-white p-5 lg:sticky lg:top-6 sm:p-6">
        <div className="border-b border-[var(--border)] pb-4">
          <div>
            <h2 className="font-semibold">Schools and programs</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Select a program here to fill both catalog fields.
            </p>
          </div>
        </div>
        <div className="mt-5 space-y-4">
          {schoolsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading catalog…</p>
          )}
          {schoolsQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              The school catalog could not be loaded.
            </p>
          )}
          {schools.map((school) => (
            <section key={school.id} aria-labelledby={`school-${school.id}`}>
              <h3
                id={`school-${school.id}`}
                className="mb-1.5 text-sm font-medium"
              >
                {school.name}
              </h3>
              <div className="space-y-1">
                {school.courses.map((course) => {
                  const selected = course.id === selectedCourseId
                  return (
                    <Button
                      key={course.id}
                      type="button"
                      size="sm"
                      variant={selected ? 'secondary' : 'ghost'}
                      aria-pressed={selected}
                      className="h-auto w-full justify-start whitespace-normal py-1.5 text-left"
                      onClick={() => {
                        setProgramHint(false)
                        form.setValue('schoolId', school.id, {
                          shouldValidate: true,
                        })
                        form.setValue('courseId', course.id, {
                          shouldValidate: true,
                        })
                      }}
                    >
                      {course.name}
                    </Button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </aside>
    </div>
  )
}
