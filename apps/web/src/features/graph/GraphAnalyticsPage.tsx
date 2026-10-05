import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { useSearchParams, Link } from 'react-router'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

type GroupBy = 'keyword' | 'course' | 'year'

interface CountItem {
  id: string
  label: string
  count: number
}

interface KeywordPair {
  firstId: string
  firstLabel: string
  secondId: string
  secondLabel: string
  count: number
}

interface AggregateResponse {
  groupBy: GroupBy
  totalPapers: number
  items: CountItem[]
  pairs: KeywordPair[]
  hasMore: boolean
  pairsHaveMore: boolean
  limit: number
}

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'keyword', label: 'Author keywords' },
  { value: 'course', label: 'Courses' },
  { value: 'year', label: 'Repository years' },
]

function searchLink(groupBy: GroupBy, item: CountItem) {
  if (groupBy === 'keyword')
    return `/search?keyword=${encodeURIComponent(item.label)}`
  return `/search?q=${encodeURIComponent(item.label)}`
}

export function GraphAnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('groupBy')
  const groupBy: GroupBy =
    requested === 'course' || requested === 'year' ? requested : 'keyword'
  const { getIdToken } = useAuth()
  const counts = useQuery({
    queryKey: ['graph-counts', groupBy],
    queryFn: async () =>
      apiFetch<AggregateResponse>(
        `/api/graph/counts?groupBy=${groupBy}`,
        await getIdToken(),
      ),
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart3 className="size-5" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">Research concentration</h1>
        </div>
        <CardDescription>
          Bounded summaries of accepted papers you are authorized to discover.
          Restricted work contributes only to repository-manager totals.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="max-w-64 space-y-2">
          <Label htmlFor="graph-group">Group visible papers by</Label>
          <Select
            value={groupBy}
            onValueChange={(value) =>
              setParams({ groupBy: value as GroupBy }, { replace: true })
            }
            items={GROUPS}
          >
            <SelectTrigger id="graph-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((group) => (
                <SelectItem key={group.value} value={group.value}>
                  {group.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {counts.isPending && <p role="status">Loading aggregate counts…</p>}
        {counts.isError && (
          <p role="alert">
            {counts.error instanceof ApiError
              ? counts.error.message
              : 'Could not load aggregate counts.'}
          </p>
        )}
        {counts.data && (
          <>
            <p className="text-sm text-muted-foreground">
              {counts.data.totalPapers} visible accepted{' '}
              {counts.data.totalPapers === 1 ? 'paper' : 'papers'}. Counts are
              recalculated from live repository metadata and are not stored.
            </p>
            {counts.data.items.length === 0 ? (
              <p>No visible papers have this metadata yet.</p>
            ) : (
              <>
                <div
                  className="w-full overflow-x-auto rounded-lg border p-3"
                  aria-label={`Visible papers grouped by ${groupBy}`}
                >
                  <div
                    className="min-w-[42rem]"
                    style={{
                      height: Math.max(320, counts.data.items.length * 42),
                    }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={counts.data.items}
                        layout="vertical"
                        margin={{ top: 8, right: 24, bottom: 8, left: 12 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          horizontal={false}
                        />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={190}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip />
                        <Bar
                          dataKey="count"
                          name="Visible papers"
                          fill="#2563eb"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <ul className="space-y-1 text-sm">
                  {counts.data.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        className="underline"
                        to={searchLink(groupBy, item)}
                      >
                        {item.label}
                      </Link>{' '}
                      — {item.count}
                    </li>
                  ))}
                </ul>
                {counts.data.hasMore && (
                  <p className="text-sm text-muted-foreground">
                    Showing the top {counts.data.limit} groups. Lower-frequency
                    groups are omitted by the response cap.
                  </p>
                )}
              </>
            )}

            {groupBy === 'keyword' && counts.data.pairs.length > 0 && (
              <section aria-labelledby="keyword-pairs-heading">
                <h2 id="keyword-pairs-heading" className="font-semibold">
                  Top co-occurring author keywords
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Each count is the number of visible papers tagged with both
                  terms; it is not semantic similarity.
                </p>
                <ol className="mt-3 space-y-2 text-sm">
                  {counts.data.pairs.map((pair) => (
                    <li key={`${pair.firstId}:${pair.secondId}`}>
                      {pair.firstLabel} + {pair.secondLabel} — {pair.count}{' '}
                      {pair.count === 1 ? 'paper' : 'papers'}
                    </li>
                  ))}
                </ol>
                {counts.data.pairsHaveMore && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Showing the top {counts.data.limit} keyword pairs.
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
