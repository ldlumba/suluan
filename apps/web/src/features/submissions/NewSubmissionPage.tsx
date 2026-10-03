import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
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
import { submissionFormSchema, type SubmissionFormValues } from './schema'

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
  invalid_form: 'The submission could not be read. Please try again.',
  storage_unavailable:
    'File storage is temporarily unavailable. Please try again in a moment.',
  unknown_school: 'The selected school is no longer available.',
  unknown_course: 'The selected course is no longer available.',
  course_school_mismatch:
    'The selected course does not belong to the selected school.',
}

export function NewSubmissionPage() {
  const { user, loading, getIdToken } = useAuth()
  const [phase, setPhase] = useState<Phase>('editing')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  // One idempotency key per form attempt: retries reuse it, a fresh form mints one.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  )

  const form = useForm<SubmissionFormValues>({
    resolver: zodResolver(submissionFormSchema),
    defaultValues: {
      title: '',
      authors: '',
      schoolId: '',
      courseId: '',
    },
  })
  const selectedSchoolId = useWatch({ control: form.control, name: 'schoolId' })
  const selectedCourseId = useWatch({ control: form.control, name: 'courseId' })

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
      <Card>
        <CardContent className="pt-6 text-sm">
          <Link to="/signin" className="underline underline-offset-4">
            Sign in
          </Link>{' '}
          with your UA Google account to submit research.
        </CardContent>
      </Card>
    )
  }

  if (phase === 'success') {
    return (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold tracking-tight">
            Submission received
          </h1>
          <CardDescription>
            Your paper is pending REO review. You will be notified of the
            decision by email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => {
              form.reset()
              setIdempotencyKey(crypto.randomUUID())
              setSubmissionId(null)
              setSubmitError(null)
              setPhase('editing')
            }}
          >
            Submit another paper
          </Button>
        </CardContent>
      </Card>
    )
  }

  async function onSubmit(values: SubmissionFormValues) {
    setSubmitError(null)
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

      const created = await apiFetch<{ id: string; status: string }>(
        '/api/submissions',
        token,
        { method: 'POST', body: form },
      )
      setSubmissionId(created.id)
      setPhase('success')
    } catch (err) {
      setPhase('editing')
      if (err instanceof ApiError && err.code && FRIENDLY_ERRORS[err.code]) {
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
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold tracking-tight">
            Submit research
          </h1>
          <CardDescription>
            Your paper goes to REO review first. Nothing is published until it
            is accepted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" {...form.register('title')} />
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
                placeholder="One per line, or comma-separated"
                {...form.register('authors')}
              />
            </div>

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
                      <SelectTrigger>
                        <SelectValue placeholder="Select a school" />
                      </SelectTrigger>
                      <SelectContent>
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
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            courses.length === 0
                              ? 'Select a school first'
                              : 'Select a course'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
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
              <Input
                id="file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) =>
                  form.setValue('file', e.target.files?.[0] as File, {
                    shouldValidate: true,
                  })
                }
              />
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

            <Button type="submit" disabled={phase === 'uploading'}>
              {phase === 'uploading' ? 'Uploading…' : 'Submit for review'}
            </Button>
            {submissionId && (
              <p className="text-xs text-muted-foreground">
                Reference: {submissionId}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <h2 className="text-base font-semibold">Schools and courses</h2>
          <CardDescription>
            Select a course here to fill both catalog fields. The paper year is
            assigned automatically when REO accepts it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
    </div>
  )
}
