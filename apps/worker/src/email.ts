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
