export type RankedRecord = { id: string }
export type TitledRankedRecord = RankedRecord & { title: string }
export type SemanticRankedRecord = TitledRankedRecord & { distance: number }
export type HybridMatchType = 'semantic' | 'exploratory' | 'keyword'

function normalizedTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/gu, ' ')
}

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
    .sort(
      (left, right) =>
        right.score - left.score || left.item.id.localeCompare(right.item.id),
    )
    .map((entry) => entry.item)
}

/**
 * Confidence-banded hybrid retrieval policy.
 *
 * The confident semantic ceiling controls labeling rather than suppressing all
 * other evidence. A bounded exploratory semantic list may participate in RRF,
 * and lexical matches remain available as explicitly labeled fallback. Exact
 * normalized-title copies are aligned to the semantic representative.
 */
export function confidenceBandedHybridFusion<
  S extends SemanticRankedRecord,
  K extends TitledRankedRecord,
>(
  semantic: readonly S[],
  keyword: readonly K[],
  confidentMaxScore: number,
): Array<(S | K) & { matchType: HybridMatchType }> {
  // Exact-title corpus copies can be represented by different record IDs in
  // each ranking. Align lexical copies to the semantic representative before
  // RRF so agreement boosts one result instead of producing two aliases.
  const semanticByTitle = new Map(
    semantic.map((item) => [normalizedTitle(item.title), item]),
  )
  const alignedKeyword = keyword.map(
    (item) => semanticByTitle.get(normalizedTitle(item.title)) ?? item,
  )
  const seenTitles = new Set<string>()
  return reciprocalRankFusion<S | K>([semantic, alignedKeyword])
    .filter((item) => {
      const title = normalizedTitle(item.title)
      if (seenTitles.has(title)) return false
      seenTitles.add(title)
      return true
    })
    .map((item) => {
      const semanticItem = semanticByTitle.get(normalizedTitle(item.title))
      return {
        ...item,
        matchType: semanticItem
          ? Number(semanticItem.distance) <= confidentMaxScore
            ? ('semantic' as const)
            : ('exploratory' as const)
          : ('keyword' as const),
      }
    })
}
