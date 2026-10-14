import { describe, expect, it } from 'vitest'
import {
  DEV_LIMITS,
  embeddingLimits,
  interactiveLimits,
  queryQuotaPolicy,
} from '../src/quota'

describe('embeddingLimits', () => {
  it('keeps the default and fixed input cap without an override', () => {
    expect(embeddingLimits(undefined)).toEqual(DEV_LIMITS)
  })

  it('accepts bounded environment-specific limits', () => {
    expect(embeddingLimits('100', '3000')).toEqual({
      maxRequests: 100,
      maxInputs: 3000,
    })
  })

  it('fails safe on invalid values and clamps excessive values', () => {
    expect(embeddingLimits('0')).toEqual(DEV_LIMITS)
    expect(embeddingLimits('20.5')).toEqual(DEV_LIMITS)
    expect(embeddingLimits('not-a-number')).toEqual(DEV_LIMITS)
    expect(embeddingLimits('1000', '9000')).toEqual({
      maxRequests: 200,
      maxInputs: 4000,
    })
  })
})

describe('interactive production limits', () => {
  it('keeps staging on the shared development bucket when unset', () => {
    expect(queryQuotaPolicy(undefined, undefined)).toEqual({
      globalBucket: 'dev_global',
      global: DEV_LIMITS,
      authenticatedUser: { maxRequests: 50, maxInputs: 50 },
    })
  })

  it('separates production semantic capacity and clamps configuration', () => {
    expect(queryQuotaPolicy('500', '10')).toEqual({
      globalBucket: 'semantic_global',
      global: { maxRequests: 500, maxInputs: 500 },
      authenticatedUser: { maxRequests: 10, maxInputs: 10 },
    })
    expect(interactiveLimits('5000', 10)).toEqual({
      maxRequests: 1000,
      maxInputs: 1000,
    })
  })
})
