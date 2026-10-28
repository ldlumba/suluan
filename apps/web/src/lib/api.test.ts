import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, ApiError } from './api'

describe('apiFetch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('surfaces a safe server message and preserves the machine code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'embedding_provider_failed',
            message:
              'Gemini could not embed this batch. Wait briefly and retry.',
          }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    await expect(
      apiFetch('/api/search/semantic/prepare', 'token'),
    ).rejects.toMatchObject<Partial<ApiError>>({
      status: 502,
      code: 'embedding_provider_failed',
      message: 'Gemini could not embed this batch. Wait briefly and retry.',
    })
  })
})
