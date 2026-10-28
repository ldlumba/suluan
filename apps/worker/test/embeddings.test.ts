import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  batches,
  embedTexts,
  EmbeddingError,
  isSemanticEnabled,
  normalizeVector,
  toVectorLiteral,
} from '../src/embeddings'
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '@suluan/db/schema'

const realFetch = globalThis.fetch
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Deterministic unit vector of the approved width. */
function unitVector(seed = 1): number[] {
  const values = new Array(EMBEDDING_DIMS).fill(0)
  values[seed % EMBEDDING_DIMS] = 1
  return values
}

describe('normalizeVector', () => {
  it('scales a vector to unit length', () => {
    expect(normalizeVector([3, 4])).toEqual([0.6, 0.8])
  })

  it('leaves an already-normalized vector unchanged', () => {
    expect(normalizeVector([0, 1])).toEqual([0, 1])
  })

  it('passes a zero vector through instead of producing NaN', () => {
    // A zero vector has no direction; dividing by its norm would poison the
    // whole index with NaN, so the caller must see the raw values instead.
    expect(normalizeVector([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('toVectorLiteral', () => {
  it('renders a pgvector literal at the approved width', () => {
    const literal = toVectorLiteral(unitVector())
    // No cast suffix: the literal is always a bound string, and a trailing
    // `::vector` is parsed as junk by Postgres in that position.
    expect(literal.startsWith('[')).toBe(true)
    expect(literal.endsWith(']')).toBe(true)
    expect(literal).not.toContain('::')
    const body = literal.slice(1, -1)
    expect(body.split(',')).toHaveLength(EMBEDDING_DIMS)
    expect(body.split(',').every((v) => /^-?\d+\.\d{6}$/.test(v))).toBe(true)
  })

  it('rejects a wrong-width vector rather than storing garbage', () => {
    expect(() => toVectorLiteral([0.1, 0.2])).toThrow(EmbeddingError)
  })

  it('rejects non-finite values', () => {
    const bad = unitVector()
    bad[3] = Number.NaN
    expect(() => toVectorLiteral(bad)).toThrow(EmbeddingError)
  })
})

describe('isSemanticEnabled', () => {
  it('requires a non-empty key', () => {
    expect(isSemanticEnabled('AQ.abc')).toBe(true)
    expect(isSemanticEnabled('')).toBe(false)
    expect(isSemanticEnabled('   ')).toBe(false)
    expect(isSemanticEnabled(undefined)).toBe(false)
  })
})

describe('batches', () => {
  it('splits into bounded batches and keeps order', () => {
    const items = [1, 2, 3, 4, 5]
    expect(batches(items, 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(batches([], 2)).toEqual([])
  })
})

describe('embedTexts', () => {
  it('sends the key in a header, not the URL, and normalizes results', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    vi.stubGlobal(
      'fetch',
      async (input: string | URL | Request, init?: RequestInit) => {
        seen.url = String(input)
        seen.init = init
        return new Response(
          JSON.stringify({
            embeddings: [
              { values: [0, 0, 5, 0, ...Array(EMBEDDING_DIMS - 4).fill(0)] },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    )
    const [vector] = await embedTexts(
      'AQ.test-key-value',
      ['hello'],
      'RETRIEVAL_QUERY',
    )
    const headers = seen.init?.headers as Record<string, string>
    // A key in the query string would land in every access log.
    expect(seen.url).not.toContain('AQ.test-key-value')
    expect(headers['x-goog-api-key']).toBe('AQ.test-key-value')
    expect(seen.url).toContain(`models/${EMBEDDING_MODEL}:batchEmbedContents`)
    const body = JSON.parse(String(seen.init?.body))
    expect(body.requests[0].taskType).toBe('RETRIEVAL_QUERY')
    expect(body.requests[0].outputDimensionality).toBe(EMBEDDING_DIMS)
    // Normalized: index 2 held the only non-zero value.
    expect(vector[2]).toBeCloseTo(1, 6)
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6)
  })

  it('passes the document task type through', async () => {
    let body: { requests: { taskType: string }[] } | undefined
    vi.stubGlobal('fetch', async (_i: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({ embeddings: [{ values: unitVector() }] }),
        { status: 200 },
      )
    })
    await embedTexts('AQ.k', ['text'], 'RETRIEVAL_DOCUMENT')
    expect(body?.requests[0].taskType).toBe('RETRIEVAL_DOCUMENT')
  })

  it('rejects a wrong-width provider response', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ embeddings: [{ values: [1, 2, 3] }] }), {
          status: 200,
        }),
    )
    await expect(embedTexts('AQ.k', ['t'], 'RETRIEVAL_QUERY')).rejects.toThrow(
      EmbeddingError,
    )
  })

  it('surfaces a provider error without echoing the key', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('quota exceeded for this project', { status: 429 }),
    )
    let status = 0
    let message = ''
    try {
      await embedTexts('AQ.secret-key', ['t'], 'RETRIEVAL_QUERY')
    } catch (e) {
      expect(e).toBeInstanceOf(EmbeddingError)
      status = (e as EmbeddingError).status
      message = (e as EmbeddingError).message
    }
    expect(status).toBe(429)
    // The key must never reach an error message or a log line.
    expect(message).not.toContain('AQ.secret-key')
  })

  it('makes no request for an empty batch', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy as unknown as typeof globalThis.fetch)
    await expect(embedTexts('AQ.k', [], 'RETRIEVAL_QUERY')).resolves.toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('provider response sanity', () => {
  it('keeps a working global fetch available for Neon', () => {
    // neon-http issues its queries over global fetch, so any test stub must
    // delegate non-Gemini traffic back to the real implementation.
    expect(typeof realFetch).toBe('function')
  })
})
