import { describe, expect, it } from 'vitest'
import {
  confidenceBandedHybridFusion,
  reciprocalRankFusion,
} from '../src/ranking'

describe('reciprocal rank fusion', () => {
  it('rewards records shared by semantic and keyword rankings', () => {
    const result = reciprocalRankFusion([
      [{ id: 'semantic-only' }, { id: 'shared' }],
      [{ id: 'shared' }, { id: 'keyword-only' }],
    ])
    expect(result.map((item) => item.id)).toEqual([
      'shared',
      'semantic-only',
      'keyword-only',
    ])
  })

  it('uses stable IDs for equal scores', () => {
    const result = reciprocalRankFusion([[{ id: 'b' }], [{ id: 'a' }]])
    expect(result.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('rejects an invalid constant', () => {
    expect(() => reciprocalRankFusion([[{ id: 'a' }]], 0)).toThrow(
      'positive integer',
    )
  })
})

describe('confidence-banded hybrid fusion', () => {
  it('returns honestly labeled keyword fallback when semantic abstains', () => {
    expect(
      confidenceBandedHybridFusion(
        [],
        [{ id: 'lexical', title: 'Keyword match' }],
        0.36,
      ),
    ).toEqual([{ id: 'lexical', title: 'Keyword match', matchType: 'keyword' }])
  })

  it('labels confident, exploratory, and keyword candidates', () => {
    const result = confidenceBandedHybridFusion(
      [
        { id: 'semantic', title: 'Semantic match', distance: 0.3 },
        { id: 'shared', title: 'Shared match', distance: 0.37 },
      ],
      [
        { id: 'shared', title: 'Shared match' },
        { id: 'keyword', title: 'Keyword-only match' },
      ],
      0.36,
    )
    expect(result.map((item) => item.id)).toEqual([
      'shared',
      'semantic',
      'keyword',
    ])
    expect(result.map((item) => item.matchType)).toEqual([
      'exploratory',
      'semantic',
      'keyword',
    ])
  })

  it('presents normalized duplicate titles once after fusion', () => {
    const result = confidenceBandedHybridFusion(
      [{ id: 'semantic-copy', title: '  Shared   Study ', distance: 0.2 }],
      [{ id: 'keyword-copy', title: 'shared study' }],
      0.36,
    )
    expect(result).toEqual([
      {
        id: 'semantic-copy',
        title: '  Shared   Study ',
        distance: 0.2,
        matchType: 'semantic',
      },
    ])
  })
})
