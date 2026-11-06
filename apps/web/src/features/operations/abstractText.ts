/** Local, deliberately small vocabulary. It is not a spelling authority. */
const words = new Set(
  `
accounting account accounts firms firm in the of and for to a an by on as at
is are was were be been with from into this that these those their its study
studies research researchers researcher qualitative quantitative narrative
design method methods data findings results analysis based using used use
among participants respondents community communities philippines philippine
pampanga university education students faculty school program programs
business government local public private service services management control
practices practice impact effects effect cybersecurity security information
systems system digital infrastructure governance transparency accountability
financial development performance challenges opportunities health social
corresponds corresponding sustainable goals goal ethical managers managers
interviews interviewed semi structured integration continuous monitoring
capacity building measures protection professionals professionals and
assumption university applications application factors perceptions experiences
technology implementation implementation outcomes outcomes revealed showed
conclusion conclusions recommendations significant relationships relationship
identified identify selected selected surveys survey conducted conducted
descriptive participants respondents professional professionals
`
    .trim()
    .split(/\s+/),
)

export interface SpacingWarning {
  word: string
  start: number
  suggestion: string | null
  key: string
}

/** Join only single line breaks, retaining blank lines and all non-whitespace. */
export function cleanAbstractWrapping(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/([^\n])\n(?!\n)/g, '$1 ')
}

/** Suggest only an unambiguous full split; unknown words receive no guess. */
function uniqueSplit(word: string): string | null {
  if (word.length > 80) return null
  const lower = word.toLowerCase()
  if (words.has(lower)) return null
  const memo = new Map<number, string[][]>()
  function splitAt(start: number): string[][] {
    if (start === word.length) return [[]]
    const cached = memo.get(start)
    if (cached) return cached
    const results: string[][] = []
    for (let end = start + 2; end <= Math.min(start + 20, word.length); end++) {
      if (!words.has(lower.slice(start, end))) continue
      for (const rest of splitAt(end)) {
        results.push([word.slice(start, end), ...rest])
        if (results.length >= 2) break
      }
      if (results.length >= 2) break
    }
    memo.set(start, results)
    return results
  }
  const splits = splitAt(0).filter((parts) => parts.length > 1)
  return splits.length === 1 ? splits[0].join(' ') : null
}

/** Bounded advisory only: may miss issues or flag legitimate technical words. */
export function findSpacingWarnings(
  text: string,
  ignored: readonly string[] = [],
): SpacingWarning[] {
  const warnings: SpacingWarning[] = []
  for (const match of text.matchAll(/\p{L}{18,}/gu)) {
    const word = match[0]
    const start = match.index
    const key = `${start}:${word}`
    if (ignored.includes(key)) continue
    warnings.push({ word, start, suggestion: uniqueSplit(word), key })
    if (warnings.length === 20) break
  }
  return warnings
}
