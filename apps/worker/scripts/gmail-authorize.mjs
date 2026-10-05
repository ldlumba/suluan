#!/usr/bin/env node
/**
 * One-time Gmail sender authorization for SULUAN staging notifications.
 *
 * Completes an OAuth loopback flow for the UA sender mailbox and pipes every
 * secret straight into `wrangler secret put` via stdin. Secrets are never
 * printed, logged, written to disk, or passed as CLI arguments (which would
 * land in shell history). Safe to re-run when swapping the sender mailbox.
 *
 * Usage: npm run authorize:gmail -w @suluan/worker
 * Prompts (hidden input): OAuth client ID, client secret, sender address,
 * REO recipient address. Nothing sensitive is echoed.
 */
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const STAGING_CONFIG = 'wrangler.staging.toml'
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

const workerDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repoRoot = path.dirname(path.dirname(workerDir))

/**
 * Single stdin reader for every prompt. An earlier version mixed Node's
 * readline (visible prompts) with a manual raw-mode handler (hidden
 * prompts); pausing stdin after a hidden prompt left readline's stream in a
 * broken state, so the next visible prompt never resolved. One handler owns
 * stdin now; visible input echoes, hidden input does not.
 */
async function prompt(label, { secret = false, def = '' } = {}) {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    throw new Error(
      'interactive terminal required; run this script directly, not piped or redirected',
    )
  }
  const suffix = def ? ` [${def}]` : ''
  process.stdout.write(`${label}${suffix}: `)
  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw ?? false
    let value = ''
    const onData = (chunk) => {
      const s = chunk.toString('utf8')
      for (const ch of s) {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.removeListener('data', onData)
          stdin.setRawMode(wasRaw)
          stdin.pause()
          process.stdout.write('\n')
          resolve(value.trim() || def)
          return
        }
        if (ch === '\u0003') {
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\b' || ch === '\x7f') {
          if (value.length > 0) {
            value = value.slice(0, -1)
            if (!secret) process.stdout.write('\b \b')
          }
          continue
        }
        value += ch
        if (!secret) process.stdout.write(ch)
      }
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

function fail(message) {
  console.error(`\nerror: ${message}`)
  process.exit(1)
}

async function wranglerSecretPut(name, value, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn('wrangler', ['secret', 'put', name, '-c', STAGING_CONFIG], {
      cwd,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    child.on('error', (err) =>
      reject(
        new Error(
          `could not run wrangler (${err.message}); is it installed and on PATH?`,
        ),
      ),
    )
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`wrangler secret put ${name} exited with code ${code}`)),
    )
    child.stdin.end(value, 'utf8')
  })
  console.log(`stored ${name}`)
}

function openBrowser(url) {
  const platform = process.platform
  const opener =
    platform === 'win32'
      ? { cmd: 'cmd', args: ['/c', 'start', '""', url] }
      : platform === 'darwin'
        ? { cmd: 'open', args: [url] }
        : { cmd: 'xdg-open', args: [url] }
  execFile(opener.cmd, opener.args, () => {})
}

async function waitForCode(server, expectedState) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for consent (5 minutes)')), CALLBACK_TIMEOUT_MS)
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      clearTimeout(timer)
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (error || !code || state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/plain' }).end('Authorization failed; you can close this tab.')
        reject(new Error(error ? `consent denied (${error})` : 'invalid callback; try again'))
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain' }).end('Authorized. You can close this tab and return to the terminal.')
      resolve(code)
    })
  })
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })
  if (!res.ok) fail(`token exchange failed: HTTP ${res.status}`)
  const data = await res.json()
  if (!data.refresh_token) {
    fail(
      'no refresh token issued; revoke the grant at Google Account → Third-party access and re-run',
    )
  }
  return data
}

async function confirmSenderMailbox(accessToken, sender) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) fail(`could not verify mailbox: HTTP ${res.status}`)
  const { emailAddress } = await res.json()
  if (typeof emailAddress !== 'string' || emailAddress.toLowerCase() !== sender.toLowerCase()) {
    fail(
      `consent came from a different mailbox; expected the sender address and will store nothing`,
    )
  }
}

const clientId = await prompt('OAuth client ID', { secret: true })
if (!clientId) fail('client ID is required')
const clientSecret = await prompt('OAuth client secret', { secret: true })
if (!clientSecret) fail('client secret is required')
const sender = await prompt('Sender UA mailbox', { def: 'ld_lumba.student@ua.edu.ph' })
if (!sender || !sender.includes('@')) fail('a valid sender address is required')
const reoMailbox = await prompt('REO recipient mailbox', { def: sender })
if (!reoMailbox || !reoMailbox.includes('@')) fail('a valid recipient address is required')

const server = createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const redirectUri = `http://127.0.0.1:${port}/callback`
const state = crypto.randomUUID()

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SEND_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString()

console.log(`\nSign in as ${sender} in the browser to authorize sending mail.`)
console.log('If the browser did not open, visit this URL manually:\n')
console.log(authUrl)
openBrowser(authUrl)

let code
try {
  code = await waitForCode(server, state)
} finally {
  server.close()
}

const tokens = await exchangeCode({ clientId, clientSecret, code, redirectUri })
await confirmSenderMailbox(tokens.access_token, sender)
console.log('\nMailbox confirmed. Storing secrets (values never shown)...')

await wranglerSecretPut('GMAIL_CLIENT_ID', clientId, workerDir)
await wranglerSecretPut('GMAIL_CLIENT_SECRET', clientSecret, workerDir)
await wranglerSecretPut('GMAIL_REFRESH_TOKEN', tokens.refresh_token, workerDir)
await wranglerSecretPut('GMAIL_SENDER', sender, workerDir)
await wranglerSecretPut('REO_MAILBOX', reoMailbox, workerDir)

console.log('\nDone. Redeploy the staging Worker so the new secrets take effect:')
console.log('  npm run deploy:worker:staging')
