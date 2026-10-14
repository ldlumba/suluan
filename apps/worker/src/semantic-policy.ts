/** A configured threshold is an evaluation policy, not launch approval. */
export function semanticMaxScore(raw?: string): number {
  if (raw === undefined) return 0.7
  if (raw.trim() === '') throw new Error('Invalid semantic maximum score')
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 0.7) {
    throw new Error('Invalid semantic maximum score')
  }
  return value
}

/**
 * Broader discovery ceiling used only for honestly labeled exploratory results.
 * Unset preserves the strict ceiling; an invalid or narrower value fails closed.
 */
export function semanticDiscoveryMaxScore(
  raw: string | undefined,
  confidentMaxScore: number,
): number {
  if (raw === undefined) return confidentMaxScore
  const value = semanticMaxScore(raw)
  if (value < confidentMaxScore) {
    throw new Error('Semantic discovery score must include the confident band')
  }
  return value
}
