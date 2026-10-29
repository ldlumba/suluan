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
  unsupported_file_type: 'Only PDF or DOCX documents are accepted.',
  filename_type_mismatch: 'The file name does not match its document type.',
  file_too_large: 'The file exceeds the 30 MB limit.',
  empty_file: 'The selected file is empty.',
  missing_file: 'A PDF or DOCX document is required.',
  invalid_fields: 'Some fields need attention. Check the title and try again.',
  invalid_keywords: 'Use at most 5 keywords, each under 100 characters.',
  invalid_form: 'The submission could not be read. Please try again.',
  storage_unavailable:
    'File storage is temporarily unavailable. Please try again in a moment.',
  unknown_school: 'The selected school is no longer available.',
  unknown_course: 'The selected course is no longer available.',
  course_inactive:
    'The selected course is no longer open for new submissions. Choose another course.',
  duplicate_pending:
    'You already have a paper with this title awaiting review. Check My submissions before sending it again.',
  course_school_mismatch:
    'The selected course does not belong to the selected school.',
}

export function NewSubmissionPage() {
  const { user, loading, getIdToken } = useAuth()
  const [phase, setPhase] = useState<Phase>('editing')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [publicMatches, setPublicMatches] = useState<
    { recordId: string; title: string; year: string | null }[]
  >([])
  const [isDragging, setIsDragging] = useState(false)
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
          Submission received
        </h1>
        <p className="mt-3 max-w-xl leading-7 text-[var(--ink-muted)]">
          Your paper is pending REO review. You will be notified of the decision
          by email.
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
      if (values.schoolId) form.append('schoolId', values.schoolId)
      if (values.courseId) form.append('courseId', values.courseId)
      if (acknowledgeDuplicate) form.append('duplicateAcknowledged', 'true')
      for (const term of values.keywords ?? []) form.append('keywords[]', term)

      const created = await apiFetch<{ id: string; status: string }>(
        '/api/submissions',
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
              Submit research
            </h1>
            <p className="mt-3 max-w-xl leading-7 text-[var(--ink-muted)]">
              Your paper goes to REO review first. Nothing is published until it
              is accepted.
            </p>
          </div>
        </div>
        <form
          onSubmit={form.handleSubmit((values) => onSubmit(values))}
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
              <Label>School</Label>
              <Controller
                control={form.control}
                name="schoolId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value)
                      form.setValue('courseId', '')
                    }}
                    items={schools.map((s) => ({
                      value: s.id,
                      label: s.name,
                    }))}
                  >
                    <SelectTrigger className="w-full">
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
            </div>
            <div className="space-y-2">
              <Label>Course</Label>
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
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          courses.length === 0
                            ? 'Select a school first'
                            : 'Select a course'
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
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Document (PDF or DOCX, up to 30 MB)</Label>
            <div
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
              className={`flex min-h-36 flex-col items-center justify-center gap-3 rounded-[8.4px] border-2 border-dashed p-6 text-center transition-colors ${
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
                  PDF or DOCX only, up to 30 MB. The file stays private until
                  REO accepts it.
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
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
                {duplicateWarning} A rejected submission does not block a
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
            {phase === 'uploading' ? 'Uploading…' : 'Submit for review'}
          </Button>
          {submissionId && (
            <p className="text-xs text-muted-foreground">
              Reference: {submissionId}
            </p>
          )}
        </form>
      </section>

      <aside className="border-t-2 border-[var(--archive-gold)] bg-white p-5 lg:sticky lg:top-6 sm:p-6">
        <div className="border-b border-[var(--border)] pb-4">
          <div>
            <h2 className="font-semibold">Schools and courses</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              Select a course here to fill both catalog fields.
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
