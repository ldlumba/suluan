import { EMBEDDING_DIMS, EMBEDDING_MODEL } from '@suluan/db/schema'

/**
 * Gemini embedding client (owner-approved 2026-10-01).
 *
 * Plain `fetch` against the REST endpoint, deliberately not the Google SDK:
 * some SDK releases carry a hardcoded `AIza` format check that rejects the
 * current `AQ.` auth keys with AUTHENTICATION_UNSUPPORTED. The REST surface has
 * no such validation, so this also keeps the dependency footprint unchanged.
 *
 * Model rationale (recorded as a §12 amendment):
 * - `text-embedding-004`, originally locked, was deprecated 2026-01-14 and has
 *   been removed from the API. It is not an option.
 * - `gemini-embedding-001` is GA, text-only, and the only GA option that still
 *   supports `taskType`, which improves asymmetric retrieval (a query embedded
 *   as RETRIEVAL_QUERY versus the same text as RETRIEVAL_DOCUMENT).
 * - `gemini-embedding-2` scores higher on MTEB multilingual (69.9 vs 68.4) but
 *   that gain is multimodal, costs 33% more per token, and drops `taskType`.
 *   An independent English-domain benchmark (Sept 2026) ranked it BELOW this
 *   model on legal (CUAD) and medical (MedRAG) retrieval.
 * - 768 dimensions retains 67.99 of the 68.32 full-width MTEB score, so the
 *   approved width costs ~0.3 points for a quarter of the storage.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** `RETRIEVAL_DOCUMENT` for indexed chunks, `RETRIEVAL_QUERY` for search terms. */
export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'

/** Model's hard input limit; our 2,000-char chunks are far below it. */
const MAX_INPUT_TOKENS = 2048
/**
 * Free-tier-safe synchronous batch. Twenty 2,000-character chunks stay below
 * the observed 30K tokens/minute ceiling when operator calls are paced.
 */
export const EMBED_BATCH_SIZE = 20

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

interface EmbedResponse {
  embeddings?: { values?: number[] }[]
  error?: { message?: string; code?: number }
}

/**
 * L2-normalize a vector. gemini-embedding-001 does NOT auto-normalize
 * truncated (non-3072) dimensions, so this is mandatory rather than cosmetic:
 * without it, stored and query vectors are compared with inconsistent norms
 * and cosine ranking is quietly wrong.
 *
 * A zero vector cannot be normalized; it is returned as-is so the caller's
 * length validation surfaces the problem instead of producing NaNs.
 */
export function normalizeVector(values: number[]): number[] {
  let sum = 0
  for (const v of values) sum += v * v
  const norm = Math.sqrt(sum)
  if (!Number.isFinite(norm) || norm === 0) return values
  return values.map((v) => v / norm)
}

/**
 * pgvector literal WITHOUT the cast suffix. The `::vector` is left off on
 * purpose: when interpolated into a parameterized query the whole literal
 * arrives as a bound string, and Postgres then parses the trailing cast as
 * junk ("Junk after closing right brace"). Call sites apply `cast(? as
 * vector)` themselves.
 *
 * Rejects wrong-width and non-finite input rather than storing garbage.
 */
export function toVectorLiteral(values: number[]): string {
  if (values.length !== EMBEDDING_DIMS) {
    throw new EmbeddingError(
      `expected ${EMBEDDING_DIMS} dimensions, got ${values.length}`,
      0,
    )
  }
  for (const v of values) {
    if (!Number.isFinite(v)) throw new EmbeddingError('non-finite value', 0)
  }
  return `[${values.map((v) => v.toFixed(6)).join(',')}]`
}

export function isSemanticEnabled(apiKey: string | undefined): boolean {
  return typeof apiKey === 'string' && apiKey.trim().length > 0
}

/**
 * Embed a batch of texts. Returns normalized vectors in input order.
 *
 * The key is sent in the `x-goog-api-key` header, never a query string, so it
 * cannot leak into request logs. Error bodies are truncated and never include
 * the key.
 */
export async function embedTexts(
  apiKey: string,
  texts: string[],
  taskType: EmbedTaskType,
): Promise<number[][]> {
  if (!texts.length) return []
  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMS,
    })),
  }
  const response = await fetch(
    `${API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    },
  )
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new EmbeddingError(
      `gemini embed failed (${response.status}): ${detail}`,
      response.status,
    )
  }
  const payload = (await response.json()) as EmbedResponse
  if (payload.error) {
    throw new EmbeddingError(
      `gemini embed error: ${payload.error.message ?? 'unknown'}`,
      payload.error.code ?? 0,
    )
  }
  const vectors = payload.embeddings ?? []
  if (vectors.length !== texts.length) {
    throw new EmbeddingError(
      `expected ${texts.length} embeddings, got ${vectors.length}`,
      0,
    )
  }
  return vectors.map((entry, i) => {
    const values = entry.values
    if (!values || values.length !== EMBEDDING_DIMS) {
      throw new EmbeddingError(
        `chunk ${i}: expected ${EMBEDDING_DIMS} dimensions, got ${
          values?.length ?? 0
        }`,
        0,
      )
    }
    return normalizeVector(values)
  })
}

/** Split into bounded batches so one paper cannot become one huge request. */
export function batches<T>(items: T[], size = EMBED_BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export { EMBEDDING_DIMS, EMBEDDING_MODEL, MAX_INPUT_TOKENS }
