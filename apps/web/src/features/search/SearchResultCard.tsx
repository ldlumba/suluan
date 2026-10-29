import { Network } from 'lucide-react'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'

export interface SearchItem {
  id: string
  title: string
  authors: string | null
  schoolName: string | null
  courseName: string | null
  year: string | null
  keywords?: string[] | null
  snippet: string | null
  fullTextStatus: 'READY' | 'PENDING' | 'FAILED'
  visibility: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
  matchType?: 'semantic' | 'exploratory' | 'keyword'
}

export function SearchResultCard({
  item,
  mode,
  groupKey,
  manager,
}: {
  item: SearchItem
  mode: 'keyword' | 'semantic' | 'title'
  groupKey: string
  manager: boolean
}) {
  const detailsAvailable = manager || item.visibility !== 'RESTRICTED'
  const keywords = item.keywords ?? []

  return (
    <li className="space-y-3 border-t-2 border-[var(--primary)] bg-white p-5 sm:p-6">
      {mode === 'semantic' && (
        <p className="eyebrow text-[var(--impact)]">
          {groupKey === 'semantic'
            ? 'Meaning match'
            : groupKey === 'exploratory'
              ? 'Broader meaning match'
              : 'Keyword match'}
        </p>
      )}
      <h2 className="display-heading text-2xl font-semibold leading-tight">
        {detailsAvailable ? (
          <Link
            className="transition-colors underline-offset-4 hover:text-[var(--signal-blue)] hover:underline"
            to={`/records/${encodeURIComponent(item.id)}`}
          >
            {item.title}
          </Link>
        ) : (
          item.title
        )}
      </h2>
      <p className="text-sm text-[var(--ink-muted)]">
        {mode === 'keyword' && (
          <>
            {item.fullTextStatus === 'READY'
              ? 'Full text searchable'
              : item.fullTextStatus === 'FAILED'
                ? 'Full-text processing failed — metadata only'
                : 'Full text pending — metadata only'}
            {' · '}
          </>
        )}
        {item.visibility === 'PUBLIC'
          ? 'Public'
          : item.visibility === 'UA_ONLY'
            ? 'University access only'
            : 'Repository managers only'}
      </p>
      <p className="text-sm text-[var(--ink-muted)]">
        {item.authors || 'Authors not listed'} ·{' '}
        {item.year || 'Year not listed'}
      </p>
      {(item.schoolName || item.courseName) && (
        <p className="text-sm text-[var(--ink-muted)]">
          {item.schoolName || 'School not listed'} ·{' '}
          {item.courseName || 'Course not listed'}
        </p>
      )}
      {keywords.length > 0 && (
        <>
          <span className="sr-only">Keywords: {keywords.join('; ')}</span>
          <div
            className="flex flex-wrap gap-2"
            aria-label={`Keywords: ${keywords.join('; ')}`}
          >
            {keywords.map((keyword) => (
              <span
                key={keyword}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium"
              >
                {keyword}
              </span>
            ))}
          </div>
        </>
      )}
      {/* Extracted text is untrusted: React text rendering only, never HTML. */}
      {item.fullTextStatus === 'READY' && item.snippet && (
        <p className="whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-4 text-sm leading-6 text-[var(--ink-muted)]">
          {item.snippet}
        </p>
      )}
      {detailsAvailable ? (
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          to={`/records/${encodeURIComponent(item.id)}`}
        >
          Read paper details
        </Link>
      ) : (
        <span className="text-xs text-[var(--ink-muted)]">
          Details unavailable for your access level
        </span>
      )}
      <Link
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        to={`/graph?record=${encodeURIComponent(item.id)}`}
      >
        <Network className="size-4" aria-hidden="true" />
        View relationships
      </Link>
    </li>
  )
}
