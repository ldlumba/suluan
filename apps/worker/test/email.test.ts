import { describe, expect, it, vi } from 'vitest'
import {
  encodeMimeMessage,
  gmailEmailAdapter,
  isGmailConfigured,
  type GmailConfig,
} from '../src/email'

const CONFIG: GmailConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  refreshToken: 'test-refresh-token',
  sender: 'sender@ua.edu.ph',
}

function decodeRaw(raw: string): string {
  const normalized = raw.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('encodeMimeMessage', () => {
  it('builds a decodable message with the expected headers', () => {
    const text = decodeRaw(
      encodeMimeMessage(CONFIG.sender, 'reo@ua.edu.ph', 'Hello', 'Line one\nLine two'),
    )
    expect(text).toContain('From: sender@ua.edu.ph')
    expect(text).toContain('To: reo@ua.edu.ph')
    expect(text).toContain('Subject: Hello')
    expect(text).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(text).toContain('Line one\r\nLine two')
  })

  it('encodes non-ASCII subjects so titles survive transport', () => {
    const text = decodeRaw(
      encodeMimeMessage(CONFIG.sender, 'reo@ua.edu.ph', 'Pag-aaral ng wikàng Filipino', 'body'),
    )
    expect(text).toContain('Subject: =?UTF-8?B?')
    expect(text).not.toContain('Subject: Pag-aaral')
  })

  it('emits URL-safe base64 without padding', () => {
    const raw = encodeMimeMessage(CONFIG.sender, 'a@b.c', 's', 'body')
    expect(raw).toMatch(/^[A-Za-z0-9-_]+$/)
  })
})

describe('gmailEmailAdapter', () => {
  it('refreshes the access token, then sends the raw message', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('oauth2.googleapis.com')) {
        return okJson({ access_token: 'access-123', expires_in: 3600 })
      }
      return okJson({ id: 'gmail-msg-1' })
    })
    const adapter = gmailEmailAdapter(CONFIG, fetchFn as typeof fetch)
    const result = await adapter.send({
      to: 'reo@ua.edu.ph',
      subject: 'Update',
      body: 'hello',
    })
    expect(result).toEqual({ providerMessageId: 'gmail-msg-1' })
    expect(calls).toHaveLength(2)
    const refreshBody = new URLSearchParams(calls[0].init.body as string)
    expect(refreshBody.get('grant_type')).toBe('refresh_token')
    expect(refreshBody.get('refresh_token')).toBe('test-refresh-token')
    expect(calls[1].url).toContain('gmail.googleapis.com')
    expect(
      (calls[1].init.headers as Record<string, string>).authorization,
    ).toBe('Bearer access-123')
    const sendBody = JSON.parse(calls[1].init.body as string) as { raw: string }
    expect(decodeRaw(sendBody.raw)).toContain('To: reo@ua.edu.ph')
  })

  it('reports a revoked refresh token distinctly without calling Gmail', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return okJson({ error: 'invalid_grant' }, 400)
      }
      throw new Error('gmail must not be called after revocation')
    })
    const adapter = gmailEmailAdapter(CONFIG, fetchFn as typeof fetch)
    await expect(
      adapter.send({ to: 'a@b.c', subject: 's', body: 'b' }),
    ).rejects.toThrow(/re-authorize/)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('throws on Gmail API failures after a successful refresh', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return okJson({ access_token: 'access-123' })
      }
      return okJson({ error: 'rateLimitExceeded' }, 429)
    })
    const adapter = gmailEmailAdapter(CONFIG, fetchFn as typeof fetch)
    await expect(
      adapter.send({ to: 'a@b.c', subject: 's', body: 'b' }),
    ).rejects.toThrow(/HTTP 429/)
  })

  it('rejects a send response without a message id', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2.googleapis.com')) {
        return okJson({ access_token: 'access-123' })
      }
      return okJson({})
    })
    const adapter = gmailEmailAdapter(CONFIG, fetchFn as typeof fetch)
    await expect(
      adapter.send({ to: 'a@b.c', subject: 's', body: 'b' }),
    ).rejects.toThrow(/missing message id/)
  })
})

describe('isGmailConfigured', () => {
  it('requires all four secrets', () => {
    expect(
      isGmailConfigured({
        GMAIL_CLIENT_ID: 'id',
        GMAIL_CLIENT_SECRET: 'secret',
        GMAIL_REFRESH_TOKEN: 'token',
        GMAIL_SENDER: 'sender@ua.edu.ph',
      }),
    ).toBe(true)
    expect(isGmailConfigured({})).toBe(false)
    expect(
      isGmailConfigured({
        GMAIL_CLIENT_ID: 'id',
        GMAIL_CLIENT_SECRET: 'secret',
        GMAIL_REFRESH_TOKEN: '  ',
        GMAIL_SENDER: 'sender@ua.edu.ph',
      }),
    ).toBe(false)
  })
})
