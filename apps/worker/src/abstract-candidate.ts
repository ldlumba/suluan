/** Best-effort, deliberately conservative extraction from already-extracted text.
 * Never treat this untrusted candidate as approved or use a model to fill gaps. */
export function findAbstractCandidate(text: string): string | null {
  const head = text.slice(0, 50_000).replace(/\r\n?/g, '\n')
  const heading = /(?:^|\n)[ \t]*abstract[ \t]*[:-]?[ \t]*\n/i.exec(head)
  if (!heading) return null
  const remaining = head.slice(heading.index + heading[0].length)
  const end =
    /(?:^|\n)[ \t]*(?:keywords?|index terms|introduction|chapter\s+(?:1|i)\b)[ \t]*(?:[:-]|\n)/i.exec(
      remaining,
    )
  if (!end) return null
  const candidate = remaining.slice(0, end.index).trim()
  if (candidate.length < 40 || candidate.length > 10_000) return null
  return candidate
}
