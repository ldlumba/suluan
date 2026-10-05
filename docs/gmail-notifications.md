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

1. In GCP project `suluan-staging`, enable the Gmail API (already done).
2. Create an OAuth client (APIs & Services → Credentials → Create Credentials
   → OAuth client ID → **Desktop app**). Note the client ID and secret.
   Branding: app name `SULUAN notifications (staging)`, support email the
   sender UA address, home page `https://suluan-staging.firebaseapp.com`,
   privacy link `https://suluan-staging.firebaseapp.com/privacy.html`
   (deployed from `hosting/public/privacy.html` via
   `firebase deploy --only hosting --project suluan-staging` after
   `firebase login`; the page is a pilot notice, not the Stage 9 policy).
   Keep publishing status **In production** (External): going back to Testing
   would expire the refresh token every 7 days.
3. Complete one consent flow for the UA sender mailbox with the standard
   `openid email` identity scopes plus the send-only
   `https://www.googleapis.com/auth/gmail.send` Gmail scope, and capture the
   **refresh token**. Use the committed helper — it opens the consent page,
   verifies the mailbox matches the sender, and pipes every secret straight
   into `wrangler secret put` without printing or storing values:
   `npm run authorize:gmail -w @suluan/worker`. It prompts for the OAuth
   client ID/secret (hidden input), the sender address, and the REO
   recipient, then stores `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
   `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, and `REO_MAILBOX`. Re-run it to
   rotate or to swap the sender mailbox later.
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

Live verification completed 2026-10-05 for the first two checks using generated
fixture submission `b584a45a-c852-40bb-825d-7f60cf70a804`: the pilot mailbox
received both messages, the acceptance email contained the exact persisted
remarks, and the queue reported `sent`. A second test used a different UA
submitter and a rejection decision. The REO notice reached `REO_MAILBOX`; the
decision notice reached the submitter rather than the REO mailbox, carried the
exact rejection remarks, and matched the submitter's authenticated status view.
Anonymous search returned no record for the rejected title. The
revocation/failure-isolation drill remains a separate Stage 7 check; do not
revoke the working grant merely to repeat successful-delivery verification.

## Rotation and revocation

- Rotate by repeating steps 3–4 with a fresh refresh token; no redeploy of
  code is needed (redeploy only to pick up the secret).
- Revoking the grant stops delivery immediately; queued events accumulate as
  `FAILED` and resume after re-authorization. Nothing is lost.
- Production sender (Workspace delegation or institutional mailbox) is a
  Stage 9 item; this temporary UA sender must not be presented as final.
