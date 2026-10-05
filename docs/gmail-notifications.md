# Gmail notifications (staging)

Owner-approved 2026-10-05. Temporary sender: the owner's UA mailbox via OAuth
user credentials. Swapping to an REO mailbox later means re-authorizing OAuth
for that mailbox and updating secrets — no code change.

## How delivery works

- Submission and decision events already write outbox rows with full drafts
  (`apps/worker/src/notifications.ts`). The queue consumer dispatches them;
  the 5-minute staging sweep retries anything unprocessed.
- `apps/worker/src/index.ts` selects the adapter at runtime: Gmail when all
  four `GMAIL_*` secrets exist, otherwise the auditable log adapter. A
  half-configured sender never silently sends — it stays on log output.
- Email is notification-only: a send failure records `FAILED`, the decision
  stands, and the sweep retries. No duplicate acceptance on retry.

## One-time setup (operator, browser + console)

These steps need the owner's Google account; they cannot be scripted.

1. In GCP project `suluan-staging`, enable the Gmail API.
2. Create an OAuth client (APIs & Services → Credentials → Create Credentials
   → OAuth client ID → **Desktop app**). Note the client ID and secret.
3. Complete one consent flow for the UA sender mailbox with the
   `https://www.googleapis.com/auth/gmail.send` scope and capture the
   **refresh token**. Any standard OAuth helper works; the token must be
   offline/long-lived.
4. Set the four Worker secrets (values never enter Git, chat, or logs):
   `wrangler secret put GMAIL_CLIENT_ID -c apps/worker/wrangler.staging.toml`
   (repeat for `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`).
5. Set `REO_MAILBOX` to the address that should receive new-submission mail:
   `wrangler secret put REO_MAILBOX -c apps/worker/wrangler.staging.toml`.
   Until it is set, submission events record `SKIPPED` visibly instead of
   sending.
6. Redeploy the staging Worker so the new secrets take effect.

## Verification (staging)

1. Submit a generated smoke paper → REO mailbox receives "New SULUAN
   submission", and the `notifications` row reads `SENT` with provider
   `gmail` plus a Gmail message ID.
2. Accept it with remarks → submitter receives the decision mail with the
   remarks included.
3. Revocation drill: revoke the grant at Google Account → Third-party access,
   trigger a send, and confirm the `notifications` row reads `FAILED` with a
   re-authorize error while the submission/decision itself is unaffected.

## Rotation and revocation

- Rotate by repeating steps 3–4 with a fresh refresh token; no redeploy of
  code is needed (redeploy only to pick up the secret).
- Revoking the grant stops delivery immediately; queued events accumulate as
  `FAILED` and resume after re-authorization. Nothing is lost.
- Production sender (Workspace delegation or institutional mailbox) is a
  Stage 9 item; this temporary UA sender must not be presented as final.
