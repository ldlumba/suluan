export type RankedRecord = { id: string }

/**
 * Rank-based fusion for retrieval lists whose raw scores are incomparable.
 * Records appearing in both lists receive a combined score; ties are stable.
 */
export function reciprocalRankFusion<T extends RankedRecord>(
  lists: readonly (readonly T[])[],
  constant = 60,
): T[] {
  if (!Number.isInteger(constant) || constant < 1) {
    throw new Error('RRF constant must be a positive integer')
  }
  const entries = new Map<string, { item: T; score: number }>()
  for (const list of lists) {
    list.forEach((item, index) => {
      const current = entries.get(item.id)
      const score = 1 / (constant + index + 1)
      if (current) current.score += score
      else entries.set(item.id, { item, score })
    })
  }
  return [...entries.values()]
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id))
    .map((entry) => entry.item)
}
