import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Free-text keyword chips, v1 (no controlled vocabulary). Enter or comma
 * commits a chip; terms are trimmed and case-insensitively deduped. The
 * Worker re-validates everything authoritatively — this is UX, not policy.
 */
export function KeywordInput({
  id,
  value,
  onChange,
  max = 5,
  error,
}: {
  id: string
  value: string[]
  onChange: (next: string[]) => void
  max?: number
  error?: string
}) {
  const [draft, setDraft] = useState('')

  function commit(raw: string) {
    const term = raw.trim()
    if (term === '') return
    const exists = value.some((v) => v.toLowerCase() === term.toLowerCase())
    if (!exists && value.length < max) onChange([...value, term])
    setDraft('')
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Keywords (optional, up to {max})</Label>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Added keywords">
          {value.map((term) => (
            <li
              key={term.toLowerCase()}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm"
            >
              <span>{term}</span>
              <button
                type="button"
                aria-label={`Remove keyword ${term}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onChange(value.filter((v) => v !== term))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={id}
        value={draft}
        disabled={value.length >= max}
        placeholder={
          value.length >= max
            ? `Maximum ${max} keywords reached`
            : 'Type a keyword, then Enter'
        }
        onChange={(e) => {
          const next = e.target.value
          // Comma commits immediately, matching prototype expectations.
          if (next.includes(',')) {
            for (const part of next.split(',')) commit(part)
          } else {
            setDraft(next)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
          }
        }}
        onBlur={() => commit(draft)}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
