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
- New-submission mail resolves authoritative metadata from Neon at dispatch
  time and, with Gmail active, reads the private R2 object only when the source
  file is at most 15 MiB. It sends multipart MIME with the PDF/DOCX attached.
  The R2 key is never placed in the outbox or email. Larger files send metadata
  and direct REO to the SULUAN review queue; submission still succeeds. The
  15 MiB ceiling lands near 20.5 MB MIME, with real margin under Gmail's ~25 MB
  decoded-message cap (measured; an 18 MiB value would land near 25.8 MB and
  risk live Gmail rejection). A hosted authenticated review link remains later work.

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
3. Revocation drill (deferred to the Stage 9 sender rotation, owner-approved
   2026-10-05): revoke the grant at Google Account → Third-party access,
   trigger a send, and confirm the `notifications` row reads `FAILED` with a
   re-authorize error while the submission/decision itself is unaffected.
   The `invalid_grant` path is pinned by unit tests; the live drill waits for
   rotation, when re-authorization happens anyway. Do not revoke the working
   grant merely to repeat successful-delivery verification.

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

Attachment delivery was live-verified on 2026-10-05 with staging Worker
`6aac2080-f02e-4919-9f98-3962b7238dbb`. Gmail displayed the submitter, multiline
authors, canonical School of Technological Studies / BS Information Technology,
and the generated PDF filename, then recognized the MIME part as one scanned,
previewable/downloadable attachment. The submission was rejected after the
check, so it produced no repository/processing derivative.
The 15 MiB ceiling and new fallback line were live-verified with Worker
`836cc94e` using a generated 15.9 MB DOCX: the REO mail carried full metadata,
no attachment, and the exact line `(not attached: file exceeds the 15 MB email
attachment limit; open it from the SULUAN review queue)`. The fixture was then
rejected, so it produced no repository/processing derivative.

A 9.9 MB paper exposed a CPU-limit failure the same day: per-byte base64
encoding killed the staging queue consumer (`Exceeded CPU Limit`) before send,
leaving the outbox retrying under lease. `base64EncodeBytes` now converts in
32 KiB native windows; keep that shape. Large-attachment delivery depends on
it, and the 200 KiB round-trip regression test guards the chunk boundaries.
Both 9.9 MB staging mails delivered after the fix (1:31 PM and 1:41 PM), each
as a single copy with a Gmail-scanned, previewable/downloadable attachment;
no at-least-once duplicate arrived. One retry fired during the deploy
propagation window and still hit the old limit, then succeeded on the next
sweep; allow a few minutes after deploy before judging large-mail delivery.

## Rotation and revocation

- Rotate by repeating steps 3–4 with a fresh refresh token; no redeploy of
  code is needed (redeploy only to pick up the secret).
- Revoking the grant stops delivery immediately; queued events accumulate as
  `FAILED` and resume after re-authorization. Nothing is lost.
- Production sender (Workspace delegation or institutional mailbox) is a
  Stage 9 item; this temporary UA sender must not be presented as final.
