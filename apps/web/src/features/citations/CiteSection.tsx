import { useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CITATION_FILENAMES,
  formatCitation,
  type CitationFormat,
  type CitationPublication,
  type CitationRecord,
} from './formatCitation'

const FORMATS: { id: CitationFormat; label: string }[] = [
  { id: 'apa', label: 'APA' },
  { id: 'bibtex', label: 'BibTeX' },
  { id: 'ris', label: 'RIS' },
]

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok: boolean
    try {
      ok = document.execCommand('copy') === true
    } catch {
      ok = false
    }
    document.body.removeChild(area)
    return ok
  }
}

export function CiteSection({
  record,
  publication,
  onCitationCopied,
}: {
  record: CitationRecord
  publication?: CitationPublication | null
  onCitationCopied?: () => void
}) {
  const [format, setFormat] = useState<CitationFormat>('apa')
  const [copied, setCopied] = useState(false)
  const published = publication
    ? formatCitation(record, format, publication)
    : null
  const repository = formatCitation(record, format)
  const citation = published ?? repository

  async function download() {
    const blob = new Blob([citation], {
      type:
        format === 'ris' ? 'application/x-research-info-systems' : 'text/plain',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = CITATION_FILENAMES[format]
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section
      aria-labelledby="cite-now"
      className="border-t border-[var(--border)] py-10"
    >
      <h2 id="cite-now" className="display-heading text-2xl font-bold">
        Cite now
      </h2>
      <p className="mt-3 max-w-prose text-sm leading-6 text-[var(--ink-muted)]">
        {published
          ? 'Published version first, from automatically verified registry metadata. The repository record follows.'
          : 'Built from this record’s SULUAN metadata. No verified external publication was found.'}
      </p>
      <div
        role="group"
        aria-label="Citation format"
        className="mt-5 inline-flex rounded-[6px] border border-[var(--border)] bg-[var(--secondary)] p-1"
      >
        {FORMATS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={format === option.id}
            onClick={() => setFormat(option.id)}
            className={`rounded-[4px] px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              format === option.id
                ? 'bg-[var(--primary)] text-white'
                : 'text-[var(--ink-muted)] hover:text-[var(--foreground)]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-4">
        {published && (
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--ink-muted)]">
              Published version
            </h3>
            <div className="mt-2 rounded-[8px] border border-[var(--border)] bg-white p-4 sm:p-5">
              <p className="whitespace-pre-wrap break-words text-sm leading-7 sm:text-base">
                {published}
              </p>
            </div>
          </div>
        )}
        <div>
          {published && (
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--ink-muted)]">
              Repository record
            </h3>
          )}
          <div
            className={`rounded-[8px] border border-[var(--border)] bg-white p-4 sm:p-5 ${published ? 'mt-2' : 'mt-0'}`}
          >
            <p className="whitespace-pre-wrap break-words text-sm leading-7 sm:text-base">
              {repository}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void copyText(citation).then((ok) => {
              if (ok) {
                onCitationCopied?.()
                setCopied(true)
                window.setTimeout(() => setCopied(false), 2000)
              }
            })
          }
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy citation'}
        </Button>
        {(format === 'bibtex' || format === 'ris') && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void download()}
          >
            <Download className="size-4" aria-hidden="true" />
            Download .{format === 'bibtex' ? 'bib' : 'ris'}
          </Button>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {copied ? 'Citation copied to clipboard.' : ''}
      </p>
    </section>
  )
}
