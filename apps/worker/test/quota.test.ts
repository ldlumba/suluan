import { describe, expect, it } from 'vitest'
import { DEV_LIMITS, embeddingLimits } from '../src/quota'

describe('embeddingLimits', () => {
  it('keeps the default and fixed input cap without an override', () => {
    expect(embeddingLimits(undefined)).toEqual(DEV_LIMITS)
  })

  it('accepts a bounded environment-specific request limit', () => {
    expect(embeddingLimits('100')).toEqual({
      maxRequests: 100,
      maxInputs: 2000,
    })
  })

  it('fails safe on invalid values and clamps excessive values', () => {
    expect(embeddingLimits('0')).toEqual(DEV_LIMITS)
    expect(embeddingLimits('20.5')).toEqual(DEV_LIMITS)
    expect(embeddingLimits('not-a-number')).toEqual(DEV_LIMITS)
    expect(embeddingLimits('1000')).toEqual({
      maxRequests: 100,
      maxInputs: 2000,
    })
  })
})
