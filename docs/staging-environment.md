# Stage 6 isolated staging environment

## Status

**DONE (2026-10-04).**
The isolated resources, migration/recovery proof, and generated-fixture exit
tests below passed. Staging does not reuse development Neon, R2, Worker,
Firebase, or Cloud Run resources. Owner decision 2026-10-04: proceed with the
single provisioned staging administrator; multi-administrator coverage is a
Stage 9 production-readiness item, not a Stage 6 gate.

The approved topology uses the existing owner accounts and billing account; it
does not require another Google login or billing account:

| Layer | Staging resource |
|---|---|
| Google Cloud / Firebase | project `suluan-staging` |
| Neon | project `suluan-staging`, database `neondb` |
| Cloudflare Worker | `suluan-api-staging` |
| Cloudflare R2 | private bucket `suluan-staging` |
| Cloudflare Queue | `suluan-notifications-staging` |
| Cloud Run Job | `suluan-processing-staging`, `asia-southeast1` |
| Service account | `suluan-processing-staging@suluan-staging.iam.gserviceaccount.com` |
| Artifact Registry | staging-project repository `suluan` |
| Browser | local Vite `http://localhost:5174` |

## Locked boundaries for this stage

- Use the normal submission, individual review, acceptance, processing, and
  keyword-indexing paths. No direct Neon/R2 import and no bulk acceptance.
- Keep R2 private. The Cloud Run Job receives no Neon/R2 credentials.
- Use metadata-server workload identity only. Never create a service-account
  JSON key or a shared processing secret.
- Do not configure `GEMINI_API_KEY`, create semantic embeddings, enable OCR, or
  run the assistant evaluation.
- Owner-approved 2026-10-05: the staging Worker runs the 5-minute scheduled
  outbox recovery sweep (`*/5 * * * *` in `wrangler.staging.toml`). Overlap is
  safe by atomic claim+lease. Cloud Run Scheduler jobs, retry/dead-letter,
  alerting, and recovery policy remain Stage 7 TBDs.
- Keep the Gmail sender disabled; staging notification delivery uses the log
  adapter and an isolated queue.
- Do not copy development database rows or R2 objects wholesale. Stage 5 uses
  only the 36 hash-selected authorized papers plus four generated fixtures.

## Operator prerequisites

All items were completed on 2026-10-04:

1. Authenticate Firebase CLI with the intended owner: `firebase login`.
2. Create or confirm GCP/Firebase project `suluan-staging` under the same owner.
3. Attach the existing billing account; do not open or prepay another account.
4. Create a billing-budget alert filtered to `suluan-staging`. Retain the
   existing account-wide PHP 250 catastrophic alert. The project threshold is
   an operator decision and must be recorded before Cloud Run activation.
5. Enable Google sign-in and authorize `localhost` in Firebase Authentication.
6. Register one Firebase web app and copy only its public client configuration
   to `apps/web/.env.staging.local`.
7. Create Neon Free project `suluan-staging` in `ap-southeast-1`. Record its
   direct endpoint for migrations and pooled endpoint for the Worker.

Provisioning used the single staging administrator
(`ld_lumba.student@ua.edu.ph`). No second staging administrator is required;
two trusted admins remain a Stage 9 production-readiness item. Production
provisioning remains separately TBD.

## Repository configuration

- `apps/worker/wrangler.staging.toml` is a separate deployment descriptor. It
  cannot overwrite `suluan-api`, bind `suluan-dev`, or inherit the development
  five-minute cron.
- `apps/worker/.dev.vars.staging.example` documents server-side placeholders.
  Actual `.dev.vars.staging` values are ignored by Git.
- `apps/web/.env.staging.example` documents public Firebase placeholders.
  Actual `.env.staging.local` is ignored by Git.
- `npm run dev:staging` runs Vite in staging mode on port 5174.
- `npm run deploy:worker:staging:dry-run` validates the staging bundle without
  changing Cloudflare. `npm run deploy:worker:staging` is the explicit deploy.

## Provisioning order

Do not skip ahead: later identities and exact-audience values depend on earlier
resource names.

1. Create GCP/Firebase and Neon staging projects; attach billing and budget.
2. Create the private R2 bucket and notification Queue.
3. Apply all committed migrations to the empty Neon database using the direct
   endpoint supplied process-locally as `DATABASE_URL`. Never replace root
   development `.env` for this step.
4. Run `npm run db:check` against that same process-local direct endpoint, then
   rerun `npm run db:migrate` and verify it is a no-op.
5. Create the staging service account with no project roles beyond those proven
   necessary for the Cloud Run Job to execute as itself.
6. Create the staging Artifact Registry repository and remotely build a versioned
   processing image. Record the immutable digest.
7. Create the bounded Cloud Run Job: one task, parallelism 1, max retries 0,
   15-minute timeout, `SULUAN_MAX_JOBS=5`, staging Worker API/audience, and the
   dedicated service account.
8. Set Worker secrets with `wrangler secret put -c
   apps/worker/wrangler.staging.toml`: pooled `DATABASE_URL`,
   `FIREBASE_PROJECT_ID`, exact `PROCESSING_SERVICE_AUDIENCE`, and exact
   `PROCESSING_SERVICE_ACCOUNT`.
9. Deploy the staging Worker and verify CORS allows only localhost:5174.
10. Create the staging web `.env.staging.local`, start `npm run dev:staging`,
    sign in, and provision the staging administrator through the dev/staging-only script.

## Migration and recovery proof

The repository has forward-only Drizzle migrations and no down scripts. Do not
claim that a SQL down-migration exists.

The Stage 6 recovery proof is:

1. Record an empty-database baseline and take the provider-supported manual
   snapshot/backup before application data is loaded.
2. Apply migrations 0000–0009 from scratch and pass `db:check`.
3. Reapply migrations and prove no schema/data duplication.
4. Insert only a generated smoke fixture, then restore/recreate from the saved
   baseline using the provider-supported mechanism.
5. Reapply migrations and pass `db:check` again.

If the Neon plan cannot restore the manual snapshot in place, test recovery by
restoring/exporting into a temporary empty branch/database, verify it, and
delete that temporary target only after evidence is recorded. Forward-fix plus
verified restore is the actual recovery posture; rollback wording must not imply
unimplemented down migrations.

## Exit evidence

Stage 6 is complete only when all of the following are recorded:

- resource IDs, regions, and owners are staging-specific;
- no secret appears in Git, browser configuration, command history, or logs;
- clean migration, no-op reapply, and restore/recreate checks pass;
- upload → individual review → acceptance → Cloud Run extraction → keyword
  preparation → search → authorized download succeeds for one generated smoke
  fixture;
- pending/rejected and restricted-access smoke checks show no leakage;
- replay creates no duplicate intake, record, job, snapshot, or chunks;
- staging budget monitoring is active;
- Cloud Run Scheduler jobs, Gemini, OCR, and Gmail production delivery remain
  disabled (the staging Worker 5-minute outbox sweep was owner-approved
  2026-10-05).

After this exit, Stage 7 reliability/security hardening runs before the full
40-fixture Stage 5 corpus is executed in Stage 8.

## Recorded verification — 2026-10-04

### Resources and safeguards

- GCP/Firebase project `suluan-staging` (project number `853974725922`) uses the
  same existing billing account as development. No new billing account or
  prepayment was created.
- A project-filtered **US$1 monthly budget** alerts at 50%, 90%, and 100%; the
  existing account-wide US$4 alert remains active.
- Firebase Google Sign-In is enabled. Authorized domains are `localhost`,
  `suluan-staging.firebaseapp.com`, and `suluan-staging.web.app`.
- Neon project ID `still-shadow-16030511` is in AWS Singapore. The Worker uses
  its pooled endpoint; migration tooling uses its direct endpoint. Credentials
  remain in ignored/local secret storage.
- Cloudflare Worker `suluan-api-staging`, private R2 bucket `suluan-staging`, and
  Queue `suluan-notifications-staging` are separate from development. CORS
  allows `http://localhost:5174` and omits ACAO for port 5173.
- Cloud Run Job `suluan-processing-staging` is one task, parallelism 1, no
  retries, a 15-minute timeout, and `SULUAN_MAX_JOBS=5`. It uses dedicated
  service account `suluan-processing-staging@suluan-staging.iam.gserviceaccount.com`.
  Image digest is
  `sha256:780dc0e5c584fb14c227f6a0c8572fdf59a40ea2a517001cd4749a06a902b59f`.
- No Cloud Run Scheduler, `GEMINI_API_KEY`, embeddings, OCR, service-account
  JSON key, or institutional Gmail sender is configured. The staging Worker
  has a five-minute outbox sweep and temporary UA OAuth sender approved on
  2026-10-05.

### Database recovery

- Migrations 0000–0009 applied from an empty database; `npm run db:check`
  passed and migration reapplication was a no-op.
- A Neon manual snapshot was captured after migration. A post-snapshot probe
  table was added, the snapshot was restored to a temporary branch, and the
  restored branch passed `db:check` with the probe absent.
- The temporary branch and the probe on the primary staging branch were deleted.
  This verifies provider restore plus forward migration; it does not claim that
  down migrations exist.

### Generated-fixture smoke tests

- A generated 1,263-byte PDF traversed upload → `PENDING` non-leakage →
  individual `PUBLIC` acceptance → Cloud Run extraction → keyword preparation
  → anonymous search (`READY`, snippet present) → public download. Manager and
  public downloads were byte-for-byte SHA-256 matches to the source.
- A second generated paper traversed individual `RESTRICTED` acceptance,
  extraction, and keyword preparation. An authenticated administrator received
  one `RESTRICTED`/`READY` result and a 200 download; anonymous search returned
  zero results and download returned the non-probing 404.
- A third generated paper was individually rejected. It produced zero research
  records and zero processing jobs and was absent from anonymous discovery.
- Final staging counts were three submissions, two accepted records, two
  extracted jobs, two keyword snapshots, two chunks, zero rejected derivatives,
  zero semantic snapshots, and zero embeddings. A final preparation replay
  reported zero papers and did not duplicate either snapshot/chunk.
- Cloud Run workload identity also passed a no-work execution. The first
  configuration-only attempt exposed three environment assignments being passed
  as one PowerShell value; the Job configuration was corrected before any job
  could be claimed, and subsequent executions succeeded.

### Gmail notification activation — 2026-10-05

- Worker version `e3ffc7dd-ed19-4a71-b811-8371c98ba389` was deployed with all
  four Gmail secrets and `REO_MAILBOX`; secret values stayed out of Git, chat,
  browser code, and logs.
- Generated fixture submission `b584a45a-c852-40bb-825d-7f60cf70a804`
  returned HTTP 201 through the normal multipart endpoint. The temporary REO
  mailbox received `New SULUAN submission: [STAGING EMAIL] Gmail Delivery Smoke
  Test 2026-10-05` at 12:15 PM.
- Individual `PUBLIC` acceptance returned HTTP 201 with remarks `Accepted for
  Gmail delivery smoke verification; generated staging fixture only.` The
  submitter received the acceptance email with those exact remarks at 12:17 PM.
- The live queue trace recorded outbox
  `ca853299-a5cf-42a6-a413-c20bb372cbb1: sent`. In this implementation, `sent`
  is returned only after Gmail supplies a non-empty message ID, a notification
  row is persisted with status `SENT` and provider `gmail`, and the outbox row
  is completed. This verifies real Gmail delivery rather than the log adapter.
- Sender and recipient are both `ld_lumba.student@ua.edu.ph` for staging only.
  Re-authorization under an institutionally owned REO mailbox remains Stage 9.
- A follow-up submission from a different authenticated UA account proved the
  recipient split and rejection path. The configured REO mailbox received the
  new-submission notice identifying the submitter; after individual rejection,
  only the submitter's mailbox received `Update on your SULUAN submission` with
  `Decision: REJECTED` and the exact reviewer remarks. The authenticated status
  page showed the same outcome and remarks, while anonymous keyword search
  returned zero results for the rejected title. The rejected submission remains
  in the REO-only staging archive by policy; it created no public search result.

- Worker `6aac2080-f02e-4919-9f98-3962b7238dbb` enriched REO mail with authors
  and canonical school/course/file metadata and attached a generated 872-byte
  PDF. Gmail rendered every field, reported one scanned attachment, and exposed
  preview/download controls for the correct filename. Submission and subsequent
  rejection both returned HTTP 201; rejection avoided repository/processing
  derivatives. Source PDF/DOCX files above 10 MiB continue as metadata-only
  notifications with an explicit SULUAN fallback.

### Stage 6 complete

- No remaining Stage 6 gate. Multi-administrator coverage is deferred to
  Stage 9 production/institutional readiness. Do not invent an identity, reuse
  a personal non-UA account, or treat the non-production promotion script as a
  production provisioning path.
