import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
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
  upload_not_found: 'The upload did not complete. Please try again.',
  upload_size_mismatch: 'The uploaded file changed during transfer. Please try again.',
  presigned_unsupported:
    'Direct uploads are unavailable with local storage emulation. Restart the Worker against remote R2 (see AGENTS.md).',
  unknown_school: 'The selected school is no longer available.',
  unknown_course: 'The selected course is no longer available.',
  course_school_mismatch: 'The selected course does not belong to the selected school.',
}

export function NewSubmissionPage() {
  const { user, loading, getIdToken } = useAuth()
  const [phase, setPhase] = useState<Phase>('editing')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  // One idempotency key per form attempt: retries reuse it, a fresh form mints one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const form = useForm<SubmissionFormValues>({
    resolver: zodResolver(submissionFormSchema),
    defaultValues: {
      title: '',
      authors: '',
      schoolId: '',
      courseId: '',
      year: '',
      researchType: '',
    },
  })
  const selectedSchoolId = useWatch({ control: form.control, name: 'schoolId' })

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
    form.setValue('courseId', '')
  }, [selectedSchoolId, form])

  if (loading) return <p className="text-sm text-muted-foreground">Checking sign-in…</p>
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
          <h1 className="text-2xl font-semibold tracking-tight">Submission received</h1>
          <CardDescription>
            Your paper is pending REO review. You will be notified of the decision by email.
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

      const initiated = await apiFetch<{ key: string; uploadUrl: string }>(
        '/api/uploads/initiate',
        token,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fileName: values.file.name,
            mimeType: values.file.type,
            sizeBytes: values.file.size,
          }),
        },
      )

      const upload = await fetch(initiated.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': values.file.type },
        body: values.file,
      })
      if (!upload.ok) throw new Error(`upload failed with status ${upload.status}`)

      const created = await apiFetch<{ id: string; status: string }>(
        '/api/submissions',
        token,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            key: initiated.key,
            fileName: values.file.name,
            mimeType: values.file.type,
            sizeBytes: values.file.size,
            idempotencyKey,
            title: values.title,
            authors: values.authors || undefined,
            schoolId: values.schoolId || undefined,
            courseId: values.courseId || undefined,
            year: values.year || undefined,
            researchType: values.researchType || undefined,
          }),
        },
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
        setSubmitError('The submission could not be completed. Please try again.')
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Submit research</h1>
        <CardDescription>
          Your paper goes to REO review first. Nothing is published until it is accepted.
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
                    onValueChange={field.onChange}
                    items={schools.map((s) => ({ value: s.id, label: s.name }))}
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
                    items={courses.map((c) => ({ value: c.id, label: c.name }))}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          courses.length === 0 ? 'Select a school first' : 'Select a course'
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input id="year" placeholder="2026" {...form.register('year')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="researchType">Research type</Label>
              <Input
                id="researchType"
                placeholder="e.g. Thesis, Capstone"
                {...form.register('researchType')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="file">Document (PDF or DOCX, up to 30 MB)</Label>
            <Input
              id="file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => form.setValue('file', e.target.files?.[0] as File, {
                shouldValidate: true,
              })}
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
            <p className="text-xs text-muted-foreground">Reference: {submissionId}</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
