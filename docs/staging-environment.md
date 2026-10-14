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

When the browser is started with the staging web environment, its API base is
`https://suluan-api-staging.ctrlfinder.workers.dev`. Deploying only
`apps/worker/wrangler.toml` updates the development API and does not update the
staging browser. Deploy staging explicitly from `apps/worker` with:

```powershell
npx wrangler deploy -c wrangler.staging.toml
```

The development and staging Workers have separate Neon, R2, Queue, and API
origins; verify the active `VITE_API_BASE_URL` before live UI checks.

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
- Cloud Scheduler job `suluan-processing-trigger` now starts that Job every 15
  minutes in UTC. It uses the least-privilege
  `suluan-processing-scheduler@suluan-staging.iam.gserviceaccount.com` identity,
  which has `roles/run.invoker` only on the processing Job. The first manually
  forced Scheduler run completed successfully on 2026-10-06; database claim
  leases remain the overlap and stale-worker safeguard.
- Cloud Scheduler job `suluan-embed-trigger` starts `suluan-embed-staging` every
  three hours in UTC. The same Scheduler identity has `roles/run.invoker` only
  on this embedding Job. Each execution is limited to one claim, has zero task
  retries, and is stopped by the Worker's shared daily quota before any paid
  provider call when capacity is exhausted. A forced trigger on 2026-10-10
  created execution `suluan-embed-staging-b2g7j`; the evaluator remains
  scheduler-free.
- The staging query and document-embedding services hold Gemini access only in
  Cloud Run; the Worker has no Gemini key. OCR, service-account JSON keys, and
  institutional Gmail sender approval remain absent. The staging Worker has a
  five-minute outbox and keyword-index sweep plus the temporary UA OAuth sender
  approved on 2026-10-05.

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
- Two real 9.9 MB submissions from a second UA account then proved the large
  path end to end on Worker `2891cc9b`: both REO mails arrived (1:31 PM and
  1:41 PM) with full metadata and exactly one Gmail-scanned, previewable/
  downloadable attachment each. The first attempt on the prior build died with
  `Exceeded CPU Limit` before send; chunked base64 conversion fixed it, and
  no duplicate arrived despite the retries.
- Worker `836cc94e` raised the ceiling to 15 MiB with the review-queue fallback
  line; a generated 15.9 MB DOCX produced exactly that metadata-only mail and
  was then rejected with no derivatives.
- Post-verification cleanup (2026-10-05): the seven labeled email/keyword
  smoke submissions (3 accepted records included) and their 14 audit,
  notification, and outbox rows each were deleted; remaining counts verified
  zero and all 7 private R2 objects removed. Shared `keywords` concept rows
  persist by append-only design. Stage 6 fixtures untouched.

- Worker `6aac2080-f02e-4919-9f98-3962b7238dbb` enriched REO mail with authors
  and canonical school/course/file metadata and attached a generated 872-byte
  PDF. Gmail rendered every field, reported one scanned attachment, and exposed
  preview/download controls for the correct filename. Submission and subsequent
  rejection both returned HTTP 201; rejection avoided repository/processing
  derivatives. Source PDF/DOCX files above 15 MiB continue as metadata-only
  notifications pointing REO at the SULUAN review queue.

### Stage 6 complete

- No remaining Stage 6 gate. Multi-administrator coverage is deferred to
  Stage 9 production/institutional readiness. Do not invent an identity, reuse
  a personal non-UA account, or treat the non-production promotion script as a
  production provisioning path.

### Stage 7 hardening and policy — 2026-10-05

- Keyword surfaces verified against the leakage rule: the exact-match filter
  and keyword display return nothing for pending/rejected records and nothing
  restricted-invisible to anonymous or non-manager viewers; managers see
  terms. Idempotent resubmission creates exactly one term set.
- Scheduler/queue policy (owner-approved): consumer `max_retries` 3, then
  `suluan-notifications-staging-dlq`; the DLQ handler emails `REO_MAILBOX` and
  always acknowledges so it can never loop. Worker `dd93d8ef` serves both
  consumers. The 5-minute outbox sweep stands; the staging processing Job is
  now started by its bounded 15-minute Cloud Scheduler trigger.
- Log policy (owner-approved): IDs and routing addresses only — never paper
  titles, remarks, or bodies — on Cloudflare default retention. The log
  adapter no longer prints subjects.
- The live Gmail revocation drill is deferred to the Stage 9 sender rotation;
  `invalid_grant` handling is pinned by unit tests.

### Stage 8 bounded pilot — completed 2026-10-05

- Run `20261005T103129Z` matched all 36 authorized source hashes after the
  reviewed P33 baseline revision, generated F01–F04, and passed the 20-test
  processing suite. The isolated working corpus contains 18 original DOCX,
  18 original PDF, three generated PDF, and one generated DOCX fixture; no
  source document or extracted text was added to Git.
- The staging importer dry-run reported 40 ready, zero skipped, zero errors,
  and zero warnings. The apply run created 40 `PENDING` submissions through
  the normal Worker route. An immediate apply replay returned the same 40 IDs;
  the manager queue contained exactly those 40 pending submissions, providing
  the run's submission-idempotency evidence without bypassing review.
- All 40 fixtures received individual manager acceptance. The governed corpus
  gates passed: 36 exact extraction baselines, four exact safe failures, 36
  keyword snapshots/1,224 chunks, 40 byte-identical manager downloads, access
  denials, idempotent replays, 21/21 positive keyword probes, and 5/5 clean
  negatives. All 80 outbox rows were processed and all notifications were sent.
- The separate frozen semantic gate failed closed: Worker requests
  intermittently received Gemini `FAILED_PRECONDITION` for unsupported request
  location. Preparation stopped at 949 pilot vectors; ranking was not treated as
  passed. The key and temporary quota override were removed, and Worker
  `2c011e64` verifies semantic as unconfigured. Full aggregate evidence is in
  `docs/stage8-pilot-results.md`.

### Isolated semantic evaluator activation — 2026-10-07

- Migration `0012` and Worker version
  `246a3cbd-7560-4684-b31e-a74923073fdb` activated the batch evaluation and
  quota-free preflight routes.
- Manual Job `suluan-semantic-eval-staging` is pinned to image digest
  `sha256:bf4fcc89fe91c101e5c2fe6df6726cd36a20cacb32f7d7d9827a81da79e0b741`,
  has one task, parallelism one, zero retries, no Gemini secret, and no
  Scheduler binding. The existing Scheduler still targets only the extraction
  Job.
- Preflight execution `suluan-semantic-eval-staging-jp9zs` authenticated and
  verified the frozen 16-query hash, 39 eligible records/1,227 chunks, zero
  missing embeddings, zero unindexed records, and corpus snapshot
  `603a92476dff09f45cfdd081fb5949e3e2753ce4646eefc11900097a1eb21bcc`.
  It failed closed only on quota headroom (20/20 requests already consumed),
  without changing the 20-request/20-input usage or creating an evaluation
  claim. No paid evaluation was run.

### Authorized legacy corpus import — 2026-10-08

- The final compressed source contained 139 opted-in papers and 18 intentional
  skips (11 without manifests and seven marked `[NO TITLE]`), with zero errors
  or warnings. Pajarillo and the temporary Word lock file were absent.
- Comparison with the governed development set matched all 139 logical paths
  and metadata fields. Sixty-eight source documents were intentionally converted
  to PDF; every unchanged-format document retained its prior hash.
- The staging dry-run passed before apply. The normal Worker submission route
  then created 139 submissions and 139 unique private-file keys. Every row
  remained `PENDING`; Neon reconciliation found zero decisions and zero
  repository records, so no imported paper became searchable or eligible for
  extraction or embeddings.
- An immediate apply replay returned all 139 original submission IDs and created
  zero rows, live-verifying environment-scoped idempotency. Notification outbox
  delivery continued asynchronously and did not affect durable submission
  success.
- Redacted operator reports remain outside Git at
  `C:\Users\Lims\AppData\Local\Temp\opencode\staging-legacy-import-{dry-run,apply,replay}-20261008.json`.
  The next gate is authorized individual review. No bulk acceptance path was
  introduced or used.

### Legacy review, extraction, and indexing — 2026-10-08

- The authorized manager individually accepted all 139 imported submissions
  through the normal review workflow. No bulk-acceptance route or direct
  database write was used.
- Thirty sequential manual executions of the existing bounded extraction Job
  ran safely alongside its scheduler. Database leases arbitrated claims; all
  139 legacy jobs reached `EXTRACTED` with zero failures.
- The Worker keyword sweep indexed all 139 records into 4,107 chunks. The
  complete extractable staging corpus is now 178 records/5,334 chunks. Four
  accepted pilot safe-failure fixtures remain correctly non-extractable and are
  not part of that retrieval corpus.

### Full-corpus embedding day 1 — 2026-10-08

- The manual, scheduler-free `suluan-embed-staging` Job was pinned to immutable
  digest `sha256:bf4fcc89fe91c101e5c2fe6df6726cd36a20cacb32f7d7d9827a81da79e0b741`,
  restricted to one claim per execution, and kept at one task/parallelism one/
  zero retries. Stale query-evaluation environment variables were removed.
- One canary and 19 additional executions were paced at least 30 seconds apart.
  All 20 claims completed once with approved model, 768 dimensions, and frozen
  chunker geometry. The daily code-owned limit closed at 20 requests/395 inputs.
- Coverage is 1,622/5,334 chunks, leaving 3,712. No evaluation was attempted.
  Continue only after UTC quota resets. The final embedding day must reserve one
  request plus 16 inputs for the frozen batched evaluation after 100% document
  coverage and a passing preflight.

#### Owner-approved temporary request revision

- Provider evidence showed Gemini Embedding 1 free-tier limits of 100 RPM,
  30K TPM, and 1,000 RPD. The staging Worker request ceiling was temporarily
  raised from 20 to 110 while the 2,000-input ceiling stayed unchanged. Worker
  `679e15f5-efa1-4085-9927-2505d1709cde` deployed the override; production
  defaults were not changed.
- The same one-claim Job and ≥30-second pacing completed another 81 paid claims.
  The next execution received no claim and no quota increment, proving the
  retained input boundary stopped work. Final daily usage was 101 requests/
  1,992 inputs; all 101 claims were used, none remained active, and geometry
  mismatches remained zero.
- Coverage ended at 3,219/5,334 chunks, leaving 2,115. Revert the staging
  overrides after complete document coverage and the one isolated frozen
  evaluation, or by 2026-10-15, whichever comes first.

#### Final-day capacity

The 2,115 remaining chunks span 62 papers and require at least 133
paper-bounded document claims. Including the one-request/16-input frozen suite,
the owner approved a superseding next-reset staging ceiling of 145 requests/
2,200 inputs. Document coverage must reach 100% before evaluation uses its
reservation. The override is still staging-only, manually paced, scheduler-free,
and subject to the same immediate/post-run or 2026-10-15 forced revert.

Worker `ef9619d3-abd7-4e88-8f11-21c25458284e` deployed the ceiling. Quota-free
preflight `suluan-semantic-eval-staging-w5mt9` verified the limits, unchanged
frozen-query hash, 178 records/5,334 chunks, zero unindexed records, and 2,115
missing embeddings. It failed closed as expected and consumed no quota.

### Completed-corpus semantic evaluation — 2026-10-09

The remaining document backfill completed with 5,334/5,334 chunks embedded.
Final preflight `suluan-semantic-eval-staging-hwckc` reported `ready: true`,
zero missing/unindexed records, corpus snapshot
`27d166be4500324a5e5bc9feb496bf2799fa82431e072f239c46581e0d1ed420`, and the
approved frozen-query hash. The isolated evaluator run
`suluan-semantic-eval-staging-6fpfj` completed one 16-input batch and stored
private artifact run `d3f267f2-983f-4496-954d-703018e584b4` with SHA-256
`70c460ec37f04e08e1b390e6046a96e4bea3c0723c868b06b029a11f745072cf`.

Offline scoring failed the preregistered MIN/0.38 gate: corrected record-ID
the scorer audit corrected title-label normalization and found 6/7 direct
positives and 3/4 hard positives at rank 1, while clean-negative abstention
was 75% for the preregistered MIN/0.38 policy. The evaluator Gemini secret was removed,
the Job was restored to quota-free `--preflight`, and Worker
`fc6f8e95-e397-42d1-8cce-f0d9d4bd5e69` restored the staging request/input
defaults to 20/2,000. No semantic or Assistant activation followed.

### Independent registered holdout — 2026-10-10

The 25-query holdout (`118734b708ab02b526bc858017bdc12180f2f4877f8ed2a7f30262ff1887c90b`,
zero overlap with the adviser suite) was run in two bounded batches against the
final corpus snapshot. Runs `bde88fc3-9193-4e71-8966-34bf5a693ac4` (20) and
`d5720549-50c9-4902-b477-aeec836564cc` (5) completed successfully. Both MIN and
top-3 aggregation reached 15/15 positive, 5/5 hard-positive, and 5/5 negative
abstention results. Offline keyword Hit@1 was 15%; record-level RRF was 100%.
This is diagnostic evidence only; the failed adviser gate still governs launch.

### Length-penalty scorer retest — 2026-10-10

The opt-in `log_length_penalized_min` scorer was temporarily deployed for a
bounded 16-query adviser retest. Preflight verified the final 178-record,
5,334-chunk corpus with zero missing vectors. Run
`e64e4019-a541-44e9-af94-d946b2af2f58` completed one provider request and
stored artifact SHA-256
`d4bda4dbd56817a42792dddd4b4418cfab2aa5e1906de46a16bade623fdb531b`.
Offline scoring reached 6/7 direct, 4/4 hard-positive, and 100% negative
abstention; the direct gate still failed on the TikTok query. A propagation bug
in the evaluation endpoint was fixed after this run, so no claim is made that
this artifact exercised the Worker scorer. The evaluator secret was detached,
the Job restored to preflight-only, and the Worker variable removed.

### Authenticated semantic canary — 2026-10-10

The owner-reviewed frozen 25-query launch suite passed 15/15 ordinary and 5/5
hard positives at rank 1 plus 5/5 negative abstention under the corrected
length-penalty/0.36 policy. The pinned regional query service passed one paid
end-to-end transport smoke in 4.675 seconds. Worker
`4d17bb95-7f45-4cbe-a2fe-a64d2bf1425b` then enabled an authenticated-UA-only
staging canary. Anonymous requests return `authentication_required` before
quota. Worker Gemini remains unset; the key exists only on Cloud Run revision
`suluan-query-staging-00005-ntj`. Evaluator remains keyless/preflight-only.

The owner then verified the live browser path with a real UA Firebase session:
tuberculosis and farmer queries returned their expected rank-1 papers, and the
negative invasion query abstained. After exact-title semantic deduplication was
deployed, both positive queries displayed one card rather than two corpus-copy
cards. Final evidence was 13 requests/74 inputs and zero active claims.

### Knowledge Graph discovery — 2026-10-05

- Worker `0e39cd2b-e8e5-4ea4-9c3b-496993bc4d23` deployed the read-only,
  paper-centered `/api/graph/neighborhood` route. The local staging frontend
  opened it from repository search and rendered the Stage 8 metadata graph
  with React Flow without browser errors.
- A public Stage 8 paper returned a bounded four-paper neighborhood on the
  first browse page. The lower-priority same-course path kept pre-keyword
  records connected while shared author keywords and authors remain the first
  ranking signals.
- A live restricted-center probe returned anonymous `404` and manager `200`.
  Anonymous and authenticated responses emit `Vary: Authorization` plus their
  respective public/private cache policy, preventing an anonymous browser
  cache entry from masking a newly authenticated graph view.
- No graph rows, snapshots, inferred aliases, citation edges, embeddings, or
  other derivatives were written. The aggregate slice below was added later
  the same day and preserves the same read-only rule.

### Knowledge Graph aggregates — 2026-10-05

- Worker `e79c8db9-224f-421a-9aa5-d1105af54eb4` added bounded
  `/api/graph/counts?groupBy=keyword|course|year` reads. The local staging
  `/graph/analytics` view rendered 15 course bars and search links without a
  browser error.
- Live per-viewer evidence: the manager saw 42 accepted records while an
  anonymous request saw 35 from the same endpoint. Both returned the same 15
  represented courses; hidden records changed only authorized totals.
- The current staging accepted corpus has zero `research_keywords` links, so
  the author-keyword view correctly displayed its empty state and no pair was
  invented. Keyword and pair visibility arithmetic is pinned by the Neon-backed
  integration fixture (two public papers versus three manager-visible papers
  when the third is RESTRICTED).
- Results are computed live with a top-20 cap. No aggregate, pair, graph, or
  analytics rows were persisted.

### Duplicate-title and course-availability safeguards — 2026-10-13

- Migration 0015 applied to staging Neon from the pooled staging credentials
  via direct endpoint; `db:check` passed and reapply was a no-op. All 185
  staging submissions backfilled `normalized_title`; 24/24 courses active.
- Worker `7a5320f2-f472-42fe-b1d7-a52b64faa8de` deployed with `--keep-vars`.
  Anonymous checks: `/api/health` 200, `/api/admin/catalog` 401,
  `/api/search/semantic?q=farmers` 200 with `authentication_required` and no
  quota spent, keyword `farmers` returns PUBLIC results, `/api/schools` 401
  anonymous. Staging CORS allows only `http://localhost:5174`.
- Staging UI served locally via `npm run dev:staging` on port 5174 against
  `https://suluan-api-staging.ctrlfinder.workers.dev`.
- Follow-up Worker `250ea206-96d4-4b0d-aa94-13c9a4919e43` (2026-10-13, no
  migration): `possible_duplicate` returns up to 3 PUBLIC-effective record
  matches; the manager queue names up to 5 matching submissions. Anonymous
  re-verified: health 200, admin catalog 401, semantic
  `authentication_required`, review queue 401.
