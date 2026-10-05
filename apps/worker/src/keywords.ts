/**
 * Author keywords v1 (Architecture v1 §12, 2026-10-05): free-text terms, up
 * to 5 per submission; no controlled vocabulary, no ranking use. This module
 * is the SINGLE normalization implementation — submission intake, repository
 * bridging, and search filtering all go through it, so the three can never
 * drift apart. Normalization is deliberately dumb (lowercase, trim, collapse
 * whitespace); synonyms are NOT merged in v1.
 */

/** Maximum author keywords per submission (matches manuscript convention). */
export const MAX_KEYWORDS = 5
/** Maximum characters per term after trimming. */
export const MAX_KEYWORD_LENGTH = 100
/** Raw multipart parts accepted before collapsing (abuse bound). */
const MAX_RAW_PARTS = 10
/** Raw part length before trimming (abuse bound; collapsed form is shorter). */
const MAX_RAW_PART_LENGTH = 200

export interface PreparedKeyword {
  /** Verbatim author term, trimmed. Preserved for provenance. */
  term: string
  /** Deduplication key. Stored alongside the term. */
  normalized: string
}

/**
 * Dumb v1 normalization: lowercase, trim, collapse every whitespace run
 * (spaces, tabs, newlines) to one space. Collapsing newlines keeps terms
 * single-line for email bodies and chip rendering.
 */
export function normalizeKeyword(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').trim()
}

export type KeywordValidationError =
  | 'too_many_parts'
  | 'part_too_long'
  | 'non_string_part'
  | 'too_many_keywords'
  | 'keyword_too_long'

/**
 * Validate raw multipart values and collapse them to ordered unique terms.
 * Duplicates collapse case-insensitively keeping the FIRST occurrence, so a
 * resubmitted chip list is stable. Returns the prepared terms or the first
 * failure — the route maps any failure to `invalid_keywords`.
 */
export function prepareSubmissionKeywords(
  input: unknown,
): { keywords: PreparedKeyword[] } | { error: KeywordValidationError } {
  const parts = Array.isArray(input) ? input : input === undefined ? [] : [input]
  if (parts.length > MAX_RAW_PARTS) return { error: 'too_many_parts' }
  const seen = new Set<string>()
  const keywords: PreparedKeyword[] = []
  for (const part of parts) {
    if (typeof part !== 'string') return { error: 'non_string_part' }
    if (part.length > MAX_RAW_PART_LENGTH) return { error: 'part_too_long' }
    const term = part.trim()
    if (term === '') continue
    const normalized = normalizeKeyword(term)
    if (normalized === '') continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    keywords.push({ term, normalized })
  }
  if (keywords.length > MAX_KEYWORDS) return { error: 'too_many_keywords' }
  for (const keyword of keywords) {
    if (keyword.term.length > MAX_KEYWORD_LENGTH)
      return { error: 'keyword_too_long' }
  }
  return { keywords }
}
