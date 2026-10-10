import { describe, expect, it } from 'vitest'
import { reciprocalRankFusion } from '../src/ranking'

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
