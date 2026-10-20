import { useQuery } from '@tanstack/react-query'
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowUpRight, Search } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError, apiFetch } from '@/lib/api'

type GraphNodeType =
  'paper' | 'author' | 'keyword' | 'course' | 'school' | 'year'

interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  recordId?: string
  normalizedName?: string
  center?: boolean
}

interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  weight?: number
}

interface Neighborhood {
  centerId: string
  depth: number
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
}

interface RecentPaper {
  id: string
  title: string
  authors: string | null
  schoolName: string | null
  courseName: string | null
  year: string | null
}

interface RecentPapersResult {
  items: RecentPaper[]
  page: number
  hasMore: boolean
}

const COLORS: Record<GraphNodeType, string> = {
  paper: '#2563eb',
  author: '#7c3aed',
  keyword: '#059669',
  course: '#d97706',
  school: '#dc2626',
  year: '#475569',
}

function flowNodes(nodes: GraphNode[]): Node[] {
  const groups = new Map<GraphNodeType, GraphNode[]>()
  for (const node of nodes) {
    const group = groups.get(node.type) ?? []
    group.push(node)
    groups.set(node.type, group)
  }
  const xByType: Record<GraphNodeType, number> = {
    school: 0,
    course: 240,
    paper: 500,
    keyword: 1000,
    author: 1240,
    year: 1480,
  }
  return (
    [
      'school',
      'course',
      'paper',
      'keyword',
      'author',
      'year',
    ] as GraphNodeType[]
  ).flatMap((type) => {
    let relatedPaper = 0
    return (groups.get(type) ?? []).map((node, row) => {
      let x = xByType[type]
      let y = row * 105
      if (type === 'paper') {
        if (node.center) {
          y = 0
        } else {
          x += (relatedPaper % 2) * 240
          y = (Math.floor(relatedPaper / 2) + 1) * 110
          relatedPaper += 1
        }
      }
      return {
        id: node.id,
        position: { x, y },
        data: { label: node.label, graphNode: node },
        style: {
          width: type === 'paper' ? 220 : 190,
          border: `${node.center ? 3 : 1}px solid ${COLORS[type]}`,
          borderRadius: 10,
          background: 'white',
          color: 'var(--foreground)',
          fontSize: 12,
          fontWeight: node.center ? 700 : 500,
          padding: 10,
        },
      }
    })
  })
}

function flowEdges(edges: GraphEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label:
      edge.type === 'SHARES_KEYWORD_WITH'
        ? `${edge.weight} shared keyword${edge.weight === 1 ? '' : 's'}`
        : edge.type.replaceAll('_', ' ').toLowerCase(),
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: edge.type === 'SHARES_KEYWORD_WITH',
    style: {
      strokeWidth: edge.type === 'SHARES_KEYWORD_WITH' ? 2 : 1,
    },
  }))
}

export function GraphPage() {
  const [params] = useSearchParams()
  const recordId = params.get('record') ?? ''
  const navigate = useNavigate()
  const { getIdToken } = useAuth()
  const graph = useQuery({
    queryKey: ['graph', recordId],
    enabled: Boolean(recordId),
    queryFn: async () =>
      apiFetch<Neighborhood>(
        `/api/graph/neighborhood?type=paper&id=${encodeURIComponent(recordId)}&depth=2`,
        await getIdToken(),
      ),
  })
  const recent = useQuery({
    queryKey: ['graph-entry-papers'],
    enabled: !recordId,
    retry: false,
    queryFn: async () =>
      apiFetch<RecentPapersResult>(
        '/api/search/records?q=&page=1&sort=newest',
        await getIdToken(),
      ),
  })
  const papers = graph.data?.nodes.filter((node) => node.type === 'paper') ?? []

  return (
    <section className="space-y-8">
      <header className="grid gap-6 border-b border-[var(--border)] pb-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
        <div>
          <p className="eyebrow text-[var(--impact)]">Knowledge graph</p>
          <h1 className="display-heading mt-3 text-4xl font-semibold sm:text-5xl">
            Research relationships
          </h1>
        </div>
        <p className="border-l-2 border-[var(--archive-gold)] pl-5 text-sm leading-6 text-[var(--ink-muted)]">
          Explore accepted papers through author-provided keywords and
          repository metadata. The graph respects the same access rules as
          search and downloads.
        </p>
      </header>

      {!recordId && (
        <div className="space-y-12" aria-labelledby="graph-start-heading">
          <section className="relative overflow-hidden bg-[var(--primary)] p-7 text-white sm:p-10">
            <div
              className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full border-[22px] border-[var(--highlight)]/90"
              aria-hidden="true"
            />
            <div className="relative max-w-3xl">
              <p className="eyebrow">Explore the collection differently</p>
              <h2
                id="graph-start-heading"
                className="display-heading mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl"
              >
                Start with a paper, then follow its connections.
              </h2>
              <p className="mt-4 max-w-2xl leading-7 text-white/75">
                See how accepted research connects through authors, keywords,
                courses, schools, and years. Choose a recent paper below or
                search the full repository.
              </p>
              <Link
                className={`${buttonVariants({ variant: 'secondary' })} mt-6 bg-white text-[var(--primary)] hover:bg-[var(--highlight)] hover:text-[var(--foreground)]`}
                to="/search"
              >
                <Search className="size-4" aria-hidden="true" />
                Search the repository
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </section>

          <section aria-labelledby="recent-research-heading">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow text-[var(--impact)]">Recent research</p>
                <h2
                  id="recent-research-heading"
                  className="display-heading mt-2 text-2xl font-semibold"
                >
                  Choose a starting point
                </h2>
              </div>
              <Link
                className="text-sm font-semibold text-[var(--primary)] underline-offset-4 hover:underline"
                to="/search?sort=newest"
              >
                View all papers <span aria-hidden="true">→</span>
              </Link>
            </div>

            {recent.isPending && (
              <p role="status" className="mt-6 text-sm text-muted-foreground">
                Loading recent papers…
              </p>
            )}
            {recent.isError && (
              <p role="alert" className="mt-6 text-sm text-muted-foreground">
                Recent papers could not be loaded. Use search to find a paper to
                explore.
              </p>
            )}
            {recent.data && recent.data.items.length === 0 && (
              <div className="mt-6 border-t border-[var(--border)] pt-6">
                <p className="font-medium">
                  No published papers are available yet.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Once accepted research is published, it will appear here as a
                  graph entry point.
                </p>
              </div>
            )}
            {recent.data && recent.data.items.length > 0 && (
              <ul className="mt-6 grid gap-x-8 md:grid-cols-2">
                {recent.data.items.slice(0, 6).map((paper, index) => (
                  <li key={paper.id}>
                    <Link
                      className="group flex h-full min-h-48 flex-col justify-between border-t-2 border-[var(--border)] py-6 transition-colors hover:border-[var(--accent)]"
                      to={`/graph?record=${encodeURIComponent(paper.id)}`}
                    >
                      <span>
                        <span className="font-mono text-xs text-[var(--ink-muted)]">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="display-heading mt-4 block text-xl font-semibold leading-snug text-foreground transition-colors group-hover:text-[var(--primary)]">
                          {paper.title}
                        </span>
                        <span className="mt-3 block text-sm text-muted-foreground">
                          {paper.authors || 'Authors not listed'}
                        </span>
                      </span>
                      <span className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>
                          {[paper.year, paper.courseName || paper.schoolName]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-[var(--primary)]">
                          Explore{' '}
                          <ArrowUpRight
                            className="size-3.5 transition-transform group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {graph.isPending && recordId && (
        <p role="status">Loading relationships…</p>
      )}
      {graph.isError && (
        <p role="alert" className="border-l-2 border-destructive pl-4">
          {graph.error instanceof ApiError
            ? graph.error.message
            : 'Could not load research relationships.'}
        </p>
      )}
      {graph.data && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-[var(--border)] pb-4 text-xs text-muted-foreground">
            {(Object.keys(COLORS) as GraphNodeType[]).map((type) => (
              <span key={type} className="flex items-center gap-1.5 capitalize">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: COLORS[type] }}
                />
                {type}
              </span>
            ))}
          </div>
          {graph.data.truncated && (
            <p role="status" className="text-sm text-muted-foreground">
              This neighborhood reached a safety limit. Refocus on a related
              paper to continue.
            </p>
          )}
          <div
            className="h-[36rem] overflow-hidden border border-[var(--border)] bg-white"
            aria-label="Interactive research relationship graph"
          >
            <ReactFlow
              nodes={flowNodes(graph.data.nodes)}
              edges={flowEdges(graph.data.edges)}
              fitView
              minZoom={0.2}
              maxZoom={1.8}
              onNodeClick={(_, node) => {
                const item = node.data.graphNode as GraphNode
                if (item.type === 'paper' && item.recordId)
                  navigate(`/graph?record=${encodeURIComponent(item.recordId)}`)
                if (item.type === 'keyword' && item.normalizedName)
                  navigate(
                    `/search?keyword=${encodeURIComponent(item.normalizedName)}`,
                  )
              }}
            >
              <Background />
              <Controls />
            </ReactFlow>
          </div>
          <section
            aria-labelledby="related-papers-heading"
            className="grid gap-4 border-t border-[var(--border)] pt-6 md:grid-cols-[15rem_1fr]"
          >
            <h2
              id="related-papers-heading"
              className="display-heading text-xl font-semibold"
            >
              Papers in this neighborhood
            </h2>
            <ul className="divide-y divide-[var(--border)] text-sm">
              {papers.map((paper) => (
                <li key={paper.id} className="py-3 first:pt-0">
                  {paper.center ? (
                    <strong>{paper.label}</strong>
                  ) : (
                    <Link
                      className="font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                      to={`/graph?record=${encodeURIComponent(paper.recordId ?? '')}`}
                    >
                      {paper.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  )
}
