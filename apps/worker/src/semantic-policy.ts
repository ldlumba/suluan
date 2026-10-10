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
