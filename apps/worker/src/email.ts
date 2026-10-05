/**
 * Outbound email boundary. The Gmail adapter arrives with sender
 * authorization; until then the log adapter records deliveries in the
 * notifications table so every attempt is visible and auditable.
 */
export interface EmailAdapter {
  name: string
  send(opts: { to: string; subject: string; body: string }): Promise<{
    providerMessageId: string
  }>
}

export function logEmailAdapter(): EmailAdapter {
  return {
    name: 'log',
    async send({ to, subject }) {
      console.log(`[email:log] to=${to} subject=${subject}`)
      return { providerMessageId: `log-${crypto.randomUUID()}` }
    },
  }
}

export interface GmailConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  /** The authorized UA mailbox, used as the MIME From address. */
  sender: string
}

/**
 * Gmail API adapter (owner-approved 2026-10-05, temporary UA sender).
 * Sends through the authorized UA mailbox via OAuth user credentials: the
 * short-lived access token is refreshed on every send, so only static
 * client credentials plus the long-lived refresh token are stored
 * server-side (Worker secrets, never Git or the browser).
 *
 * Failure contract matches the outbox: every failure throws, the caller
 * records FAILED, and the sweep retries. A revoked refresh token
 * (`invalid_grant`) throws a distinct error so the operator knows to
 * re-authorize instead of waiting on retries.
 */
export function gmailEmailAdapter(
  config: GmailConfig,
  fetchFn: typeof fetch = fetch,
): EmailAdapter {
  return {
    name: 'gmail',
    async send({ to, subject, body }) {
      const accessToken = await refreshAccessToken(config, fetchFn)
      const raw = encodeMimeMessage(config.sender, to, subject, body)
      const res = await fetchFn(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        },
      )
      if (!res.ok) {
        const detail = await readErrorDetail(res)
        throw new Error(`gmail send failed: HTTP ${res.status}${detail}`)
      }
      const data = (await res.json()) as { id?: unknown }
      if (typeof data.id !== 'string' || data.id.length === 0) {
        throw new Error('gmail send failed: missing message id')
      }
      return { providerMessageId: data.id }
    },
  }
}

async function refreshAccessToken(
  config: GmailConfig,
  fetchFn: typeof fetch,
): Promise<string> {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!res.ok) {
    const data = await readJsonBody(res)
    if (data.error === 'invalid_grant') {
      throw new Error(
        'gmail refresh token revoked or expired: re-authorize the sender mailbox',
      )
    }
    throw new Error(
      `gmail token refresh failed: HTTP ${res.status}${data.error ? ` (${data.error})` : ''}`,
    )
  }
  const data = (await res.json()) as { access_token?: unknown }
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('gmail token refresh failed: missing access token')
  }
  return data.access_token
}

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = (await res.json()) as unknown
    return typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

async function readErrorDetail(res: Response): Promise<string> {
  const data = await readJsonBody(res)
  const message =
    typeof data.message === 'string'
      ? data.message
      : typeof data.error === 'string'
        ? data.error
        : ''
  return message ? `: ${message.slice(0, 200)}` : ''
}

/** Minimal RFC 2822 message; headers use CRLF, body is UTF-8 plain text. */
export function encodeMimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
): string {
  const normalizedBody = body.replace(/\r?\n/g, '\r\n')
  const header = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    '',
  ].join('\r\n')
  return base64UrlEncode(header + normalizedBody)
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject
  return `=?UTF-8?B?${base64Encode(subject)}?=`
}

function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64UrlEncode(text: string): string {
  return base64Encode(text)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** True only when every Gmail secret is present and non-empty. */
export function isGmailConfigured(env: {
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
  GMAIL_SENDER?: string
}): boolean {
  return [env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET, env.GMAIL_REFRESH_TOKEN, env.GMAIL_SENDER].every(
    (v) => typeof v === 'string' && v.trim().length > 0,
  )
}
