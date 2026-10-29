import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpenCheck, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

interface CourseRow {
  schoolId: string
  schoolName: string
  id: string
  name: string
  active: boolean
  updatedAt: string
}

export function AdminCatalogPage() {
  const { user, profile, loading, getIdToken } = useAuth()
  const queryClient = useQueryClient()
  const catalog = useQuery({
    queryKey: ['admin-catalog', profile?.id],
    enabled: profile?.role === 'ADMIN',
    retry: false,
    queryFn: async () =>
      apiFetch<CourseRow[]>('/api/admin/catalog', await getIdToken()),
  })
  const toggle = useMutation({
    mutationFn: async (course: CourseRow) =>
      apiFetch<CourseRow>(
        `/api/admin/courses/${encodeURIComponent(course.id)}`,
        await getIdToken(),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            active: !course.active,
            expectedUpdatedAt: course.updatedAt,
          }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['schools'] })
    },
  })

  if (loading) return <p role="status">Checking access…</p>
  if (!user) return <p>Sign in to manage the institutional catalog.</p>
  if (profile?.role !== 'ADMIN')
    return <p>Only administrators can manage course availability.</p>
  if (
    [catalog.error, toggle.error].some(
      (error) => error instanceof ApiError && error.status === 403,
    )
  )
    return <NotFoundPage />

  const schools = new Map<string, { name: string; courses: CourseRow[] }>()
  for (const course of catalog.data ?? []) {
    const school = schools.get(course.schoolId) ?? {
      name: course.schoolName,
      courses: [],
    }
    school.courses.push(course)
    schools.set(course.schoolId, school)
  }

  return (
    <section className="space-y-8">
      <header className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <BookOpenCheck
              className="size-7 text-[var(--primary)]"
              aria-hidden="true"
            />
            <h1 className="display-heading text-4xl font-semibold">
              Course availability
            </h1>
          </div>
          <p className="mt-3 max-w-2xl leading-7 text-[var(--ink-muted)]">
            Hidden courses disappear from new submission forms. Existing papers
            keep their original course and remain searchable.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={catalog.isFetching}
          onClick={() => void catalog.refetch()}
        >
          <RefreshCw
            className={`size-4 ${catalog.isFetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </header>

      {catalog.isPending && <p role="status">Loading courses…</p>}
      {catalog.isError && (
        <p role="alert" className="text-destructive">
          The course catalog could not be loaded.
        </p>
      )}
      {toggle.isError && (
        <p role="alert" className="text-destructive">
          {toggle.error instanceof ApiError
            ? toggle.error.message
            : 'The course could not be updated.'}
        </p>
      )}
      {catalog.isSuccess && catalog.data.length === 0 && (
        <div className="border-t-2 border-[var(--primary)] bg-white p-6">
          <p className="font-semibold">No courses are configured.</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Additions to the institutional catalog still require a governed
            database migration.
          </p>
        </div>
      )}

      <div className="space-y-8">
        {[...schools.entries()].map(([schoolId, school]) => (
          <section
            key={schoolId}
            aria-labelledby={`catalog-school-${schoolId}`}
          >
            <h2
              id={`catalog-school-${schoolId}`}
              className="border-b border-border pb-3 text-xl font-semibold"
            >
              {school.name}
            </h2>
            <ul className="divide-y divide-border">
              {school.courses.map((course) => (
                <li
                  key={course.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{course.name}</p>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-[var(--ink-muted)]">
                      {course.active ? (
                        <Eye className="size-4" aria-hidden="true" />
                      ) : (
                        <EyeOff className="size-4" aria-hidden="true" />
                      )}
                      {course.active
                        ? 'Available for new submissions'
                        : 'Hidden from new submissions'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(course)}
                  >
                    {course.active ? 'Hide course' : 'Restore course'}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  )
}
