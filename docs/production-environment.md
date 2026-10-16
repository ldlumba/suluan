# Production environment

## Status

**PROVISIONING IN PROGRESS (2026-10-14).** Core production resources are
created and verified below; Cloud Run services, schedulers, budget alert,
Gmail sender, corpus import, Gemini/model activation, and app publishing
remain. No staging/development resource, credential, or row has been reused.

### Provisioning evidence — 2026-10-14

- Google/Firebase project `suluan-production` (number `804189788259`) with
  owner billing linked; run/artifact-registry/cloud-build/secret-manager/
  scheduler/firebase/identity-toolkit/generativelanguage APIs enabled.
  Artifact Registry `asia-southeast1` repository `suluan`; service accounts
  `suluan-processing-production`, `suluan-query-production`,
  `suluan-assistant-production`, `suluan-scheduler-production` (least
  privilege, no project roles granted yet beyond Cloud Run execution).
- Firebase web app `1:804189788259:web:b0cb99dfe4ebd88def4056`; Google
  sign-in enabled; authorized domains `localhost`,
  `suluan-production.firebaseapp.com`, `suluan-production.web.app`,
  `suluan-repository.pages.dev`. OAuth brand `SULUAN` (External,
  Testing) with owner support email; test users are the two owner
  accounts only. Publishing to production is a pre-broad-launch gate.
- Neon project `suluan-production` (`lively-glitter-84818346`), AWS
  Singapore, default branch `production`. Migrations 0000–0016 applied
  from empty with the direct endpoint; `db:check` passed (catalog 4/24,
  role counter synchronized); reapply was a no-op. Credentials live only
  in ignored local storage and Worker secrets, never in Git.
- Cloudflare: private R2 `suluan-production`,
  `suluan-notifications-production` + DLQ, Pages project
  `suluan-repository` deployed from `main` with SPA fallback.
  Worker `suluan-api-production` version
  `17cf264f-a763-41bb-b177-0555b394d5a` with the committed production
  bindings plus secrets `DATABASE_URL` (pooled), `FIREBASE_PROJECT_ID`,
  `PROCESSING_SERVICE_AUDIENCE`, `PROCESSING_SERVICE_ACCOUNT`; no Gemini
  or Gmail secret is attached. Verified: `/api/health` ok, anonymous
  keyword search empty, anonymous semantic
  `authentication_required`, anonymous Assistant limits 401, and
  successful cross-origin calls from the deployed Pages origin.
- Cloud Run images pinned in production Artifact Registry: processing
  `sha256:0383ef16…`, query-service `sha256:79aa459f…`, assistant
  `sha256:f30aea3a…`. Bounded Job `suluan-processing-production`
  (1 task, parallelism 1, 0 retries, 15-minute timeout, 1 CPU/512Mi,
  `SULUAN_MAX_JOBS=5`, dedicated service account) completed an
  empty-queue execution with `no claimable jobs`, proving workload
  identity and the claim path. The bounded 15-minute scheduler
  (`suluan-processing-production-trigger`, least-privilege invoker-only
  scheduler identity) is bound and a forced run completed with
  `no claimable jobs`, so acceptances extract automatically during the
  governed import. Query/assistant services are not
  created until the Gemini key and stable-model decision land.

### AI services evidence — 2026-10-14 (wiring pending corpus completion)

- Owner decision 2026-10-14: production Assistant keeps the staging
  model `gemini-3-flash-preview` (parity over migration); no model
  change is approved by this. The production structured-output/citation
  canary is still required before broad access.
- Services `suluan-query-production` and `suluan-assistant-production`
  (`asia-southeast1`, pinned digests `sha256:79aa459f…` /
  `sha256:f30aea3a…`, dedicated service accounts, max 1 instance,
  public ingress with ticket-based service auth exactly like staging,
  `GEMINI_API_KEY` from Secret Manager `gemini-api-key`) both report
  `/health` up. Worker URL wiring (`QUERY_EMBEDDING_URL`,
  `ASSISTANT_SERVICE_URL` + pinned identities) lands only after the
  corpus is fully extracted, indexed, and embedded; until then both
  paths stay disabled/fallback by configuration, not by code branch.

- Temporary sender `ld_lumba.student@ua.edu.ph` authorized via a
  production Desktop OAuth client (send-only scope); secrets
  `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN/SENDER` plus `REO_MAILBOX` are
  stored against the production Worker only. A first live drill failed
  closed with bare `HTTP 403` because the Gmail API was not enabled on
  the new project; the nested-error fix (committed) exposed the reason,
  the API was enabled, and automatic retries delivered both mails
  exactly once (`SENT` with Gmail message IDs, no duplicates).
- Generated fixture `[GMAIL PROOF]` completed the real browser-to-API
  path (multipart upload → R2 → atomic intake/outbox → queue consumer →
  Gmail) and was then REJECTED with exact remarks, so the production
  repository still holds zero records. The mailbox received the REO
  submission notice with downloadable PDF attachment and the submitter
  rejection notice with exact remarks (owner-confirmed 2026-10-14).

### Corpus import evidence — 2026-10-14

- Governed folder `2026 PAPERS` verified locally: 157 documents =
  139 with manifests plus 18 intentional skips (11 no-manifest, 7
  `[NO TITLE]`), matching the staging corpus identity.
- Importer dry-run against the production API: 139 ready, 18 skipped,
  0 errors, 0 warnings. Apply created 139 unique `PENDING` submissions
  with zero new decisions or repository records (plus the earlier
  REJECTED Gmail fixture), confirming non-leakage. Immediate replay
  would return the same IDs per environment-scoped idempotency.
- Individual owner review/acceptance of all 139 is now due in the
  production review queue (50 per batch); the 15-minute scheduler
  extracts acceptances automatically and the 5-minute sweep indexes
  them for keyword search.

### Embedding backfill — day 1 (2026-10-15, temporary 160/2,000 ceiling)

- Paced manual executions (1 claim each, ~60s apart, zero retries):
  101 requests / 1,989 inputs consumed, 3,070/4,107 chunks embedded,
  1,037 missing. Loop stopped on the inputs guard as designed.
- One execution hit a transient Gemini 503 (`UNAVAILABLE`) and exited 1
  with no automatic retry; its pre-consumed quota was not refunded and
  later claims embedded the remaining chunks (embed-once storage
  guarantee intact). Remainder (~1,037 inputs, ~50 requests) fits in one
  fresh UTC day, then the ceiling reverts to 20/2,000.

### Production AI canary — 2026-10-16 (owner-authenticated)

- Semantic positive `study about farmers`: 200, `semanticStatus:
  ready`, farming papers rank-1 (FARMARKET top) in 5.7s. Negative
  `quantum entanglement photon teleportation`: 200 with zero items
  (clean abstention, no spurious fallback).
- Assistant `What SULUAN papers help local farmers in Pampanga?`:
  200, `grounded_answer` in 8.6s naming real corpus papers (AgriKlima,
  FARMARKET). Server accounting: 1/10 user + 1/300 aggregate Assistant,
  retrieval in its own pool, semantic in `semantic_global` +
  per-profile pool, document pool untouched.
- Earlier tab-state hangs during probing were a wedged automation-renderer
  session (resolved by fresh sign-in), not a deployment fault: no quota
  was consumed by the timed-out attempts and no ticket was stranded.

### Embedding completion evidence — 2026-10-16

- Day 2 consumed 54 requests / 1,037 inputs for the final 1,037 chunks:
  4,107 chunks / 4,107 vectors / 0 missing, all vectors 768-dim,
  211 document claims with zero open/expired-unclosed. Temporary ceiling
  reverted to 20/2,000 the same day (deployed). Total backfill spend:
  155 requests / 3,026 inputs across two UTC days.

### Extraction completion evidence — 2026-10-15

- All 139 accepted papers individually reviewed; 139 repository records
  (all PUBLIC) with 139 processing jobs. Thirty bounded manual
  executions plus the 15-minute scheduler reached 138 `EXTRACTED` with
  one transient `DOWNLOAD_FAILED`; the governed manager retry
  re-queued it and one more execution completed it. Final: 139/139
  `EXTRACTED`, zero failures, 139 keyword snapshots, 4,107 chunks. No
  bulk-acceptance mechanism was introduced.

SULUAN will launch as a real production service temporarily owned, operated,
and billed by the project owner. Institutional handover remains required. The
production environment must not reuse development or staging data resources,
credentials, service identities, or storage objects even when all environments
share the owner's provider billing accounts.

## Approved launch topology

| Layer | Production resource |
|---|---|
| Frontend | Cloudflare Pages `suluan-repository.pages.dev` |
| API | Cloudflare Worker `suluan-api-production` |
| Storage | private R2 bucket `suluan-production` |
| Notifications | `suluan-notifications-production` + DLQ |
| Database | separate Neon project `suluan-production` in Singapore |
| Identity / compute | separate Google/Firebase project `suluan-production` |
| Processing | bounded Cloud Run Jobs/services in `asia-southeast1` |
| Source | private owner-controlled GitHub repository |

Workers Free is the approved initial Cloudflare plan. Upgrade review is
triggered by CPU-limit errors, a queue backlog approaching Free's 24-hour
retention, or sustained traffic above 70,000 Worker requests/day. Static assets
remain free; current staging traffic is far below the request ceiling.

## Access and AI policy

- Public visitors retain visibility-filtered keyword discovery and PUBLIC files.
- Any server-verified `ua.edu.ph` profile may use authenticated Semantic Search.
- Semantic Search is limited to 10 meaning-based queries/user/UTC day and 500
  aggregate/day. It uses a production-only quota bucket; exhaustion falls back
  to labeled keyword evidence.
- Any server-verified UA profile may use the Assistant after affirming that they
  are at least 18. Limits remain 10 messages/user/day, 300 aggregate/day, a
  10-second cooldown, 1,000 prompt characters, 10 turns, 800 output tokens, and
  five PUBLIC-only evidence chunks.
- Assistant retrieval has a separate 300-request/day pool. If exhausted, the
  Assistant may provide labeled general guidance without claiming a repository
  no-match. No provider call is automatically retried.
- The paid Gemini tier is required. PUBLIC-only evidence remains deliberately
  narrower than signed-in repository visibility. Users are warned not to submit
  personal, confidential, restricted, or unpublished information.
- Production retains the validated 0.36 confidence ceiling and, by owner
  approval on 2026-10-16, admits scores through 0.40 only as explicitly labeled
  exploratory results.

## Data initialization

Production starts from clean migrations and the approved institutional catalog.
Import the governed 139-paper legacy set once through the existing importer and
normal individual review workflow. Do not clone staging profiles, submissions,
audit history, generated fixtures, 36 duplicate pilot copies, usage counters,
or provider claims. Hash/manifests remain the corpus identity boundary.

## Ownership and administration

The project owner is the initial infrastructure, billing, deployment, and
application administrator. On 2026-10-16, the owner promoted
`majtayag.student@ua.edu.ph` from USER to ADMIN through the production Admin
users page. Authoritative verification found two administrators, a synchronized
`role_management_state.admin_count` of 2, and the expected `role.changed` audit
event. This satisfies the separate recovery-administrator gate. First-admin
bootstrap must be production-explicit and audited; the development promotion
script must not be pointed at production.
Subsequent role changes require ADMIN authorization, audit history, stale-write
protection, and a guard against removing the last administrator.

The temporary authorized UA Gmail mailbox remains the initial production sender
and REO mailbox. Rotation to an institutional mailbox is a required handover
item, not a code change.

## Provisioning and launch gates

1. Review accumulated changes, scan for secrets, pass all TypeScript/Python
   checks, and push reviewable commits to the private GitHub repository.
2. Create separate production Neon, Google/Firebase, Cloudflare, and Cloud Run
   resources. Attach existing billing accounts with project-specific alerts.
3. Apply migrations from empty with the direct Neon endpoint, pass `db:check`,
   prove no-op reapply, and verify a provider-supported restore into a temporary
   target before loading papers.
4. Configure only public Firebase values in the Pages build. Keep Neon, Gmail,
   Gemini, and service credentials in provider secret stores.
5. Deploy the Worker keyless first; verify health, anonymous denials, exact CORS,
   and workload identity before attaching Gemini/Gmail credentials.
   Migrate the Assistant from `gemini-3-flash-preview` to an owner-approved
   stable model and rerun its structured-output/citation canary first; current
   Google guidance recommends stable `gemini-3.6-flash` as that preview's
   replacement, while `gemini-3.8-flash` is the newest stable Flash model.
6. Provision and verify the owner administrator, then a separate recovery admin.
7. Import the authorized corpus, individually review it, process/index/embed it,
   and reconcile hashes/counts with no staging/test rows.
8. Run access, leakage, idempotency, queue/DLQ, restore, quota, AI citation,
   prompt-injection, rollback, direct-route, and mobile/desktop smoke checks.
9. Launch with active billing/usage review. Immediate rollback is disabling the
   Pages deployment, Worker AI service URLs, or production Worker route without
   deleting authoritative Neon/R2 data.

### First administrator command

After the owner signs in once through the production Firebase project, use the
production Neon **direct** endpoint and an exact host/phrase confirmation:

```powershell
$env:SULUAN_ENVIRONMENT = 'production'
npm run db:bootstrap-admin:production -- --email owner@ua.edu.ph --expected-host '<direct-neon-host>' --confirm 'BOOTSTRAP owner@ua.edu.ph IN PRODUCTION'
```

The command refuses pooled endpoints, refuses a second bootstrap, and writes
`role.bootstrap_admin` to `audit_events` in the same transaction. Later changes
must use `/admin/users`; do not use `db:promote-admin` outside development.
### Production semantic discovery revision — 2026-10-16

- Owner comparison of live staging and production results approved adopting
  staging's bounded exploratory band in production. `0.36` remains the
  confident ceiling; scores in `(0.36, 0.40]` are shown only under the existing
  **Possibly related papers** label. Authentication, visibility, quota,
  regional transport, hybrid scoring, keyword-fallback provenance, and
  no-automatic-retry safeguards are unchanged.
- Production and staging still cannot return identical lists: production holds
  only the governed 139-paper corpus, while staging also contains pilot and
  duplicate records.
