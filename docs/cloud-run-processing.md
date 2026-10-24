# Cloud Run document processing

## Status

Development activation is verified as of 2026-10-03. The bounded pull
contract and container entry point are implemented, remotely built, deployed
as a manual Cloud Run Job, and smoke-tested end to end against the deployed
Worker and remote R2. The PHP 250 monthly budget alert is set. Staging now
uses a bounded Cloud Scheduler trigger; development remains manual until its
own scheduling decision is made.

## Development smoke test (2026-10-03)

- Project/region/job: `suluan-dev` / `asia-southeast1` / `suluan-processing`.
- Successful execution: `suluan-processing-lssfx` (`1 / 1 complete`).
- Tested image digest:
  `sha256:b178570b3afb9017e7a332f2e45f6d2a76c6073e73f0244e341c8c52c7b2e033`.
- Worker origin and workload audience:
  `https://suluan-api.ctrlfinder.workers.dev` (both values identical).
- Service identity: dedicated `suluan-processing` service account; short-lived
  metadata-server ID token only, no JSON key and no shared secret.
- Fixture: `[CLOUD TEST] Processing smoke test`, accepted by a manager, then
  claimed, downloaded through the Worker, extracted in Cloud Run, and posted
  with the claim-token lease. Search showed
  `Full text searchable · Public` after keyword preparation.
- Two faults were found and fixed during activation: missing Job environment
  variables on first creation (container exit 2), and Cloudflare edge error
  1010 rejecting the bare Python client before the Worker ran. The runner now
  sends a browser-compatible `User-Agent` and reports only the endpoint path,
  HTTP status, Worker error body, and token `aud`/`email`/`iss`/`exp` claims —
  never tokens, document bytes, or secrets.

Deployment stays bounded: one task, parallelism 1, max retries 0, 15-minute
timeout, `SULUAN_MAX_JOBS=5`. Staging Scheduler runs every 15 minutes in UTC;
the database claim lease and the next scheduled run provide recovery for an
interrupted Job. Production scheduling still requires its own billing,
monitoring, alerting, and recovery approval.

## Locked delivery and identity design

SULUAN uses a **Cloud Run Job** rather than an always-on service:

1. Acceptance atomically creates a durable `processing_jobs` row in Neon.
2. A bounded Cloud Run Job starts and obtains a short-lived Google-signed ID
   token from the metadata server. There is no downloaded service-account key.
3. The job calls the Worker's internal processing API. The Worker verifies the
   Google signature, expiry, issuer, exact configured audience, verified email,
   and exact dedicated service-account email.
4. The Worker atomically claims the oldest eligible job with a ten-minute lease.
5. The job downloads the accepted file through the Worker. R2 remains private;
   the Cloud Run identity receives no R2 or Neon credentials.
6. Existing bounded PyMuPDF/python-docx extraction runs in the container. The
   result is posted with the claim token and accepted only while that lease is
   current. Identical completion replay is harmless.
7. The execution stops when no work remains or after its explicit job bound.

The job has no inbound application endpoint. A crash leaves a leased row that a
later execution can reclaim after expiry. Deterministic extraction failures stay
`FAILED` and still require an explicit manager retry. The notification Queue is
separate and unchanged; Neon is the processing queue under the owner-approved
pull design.

## Worker-only API

All routes require the workload token and return `private, no-store`:

- `POST /api/internal/processing/claim` with `{}` claims the oldest eligible
  job. Optional `{ "jobId": "uuid" }` supports deterministic recovery/testing.
  A `204` means no work. The response contains `jobId`, `submissionId`, and a
  random lease `claimToken`.
- `GET /api/internal/processing/:id/download?claimToken=...` streams the private
  accepted file only for a live matching claim.
- `POST /api/internal/processing/:id/result` uses the existing fenced result
  schema and replay behavior.

The workload identity is not a Firebase user, is never auto-created as a Neon
profile, cannot call manager routes, and records system audit events with a null
user actor plus its service-account email in audit context.

## Semantic evaluation Job separation — 2026-10-07

Semantic evaluation must use a distinct manual Cloud Run Job,
`suluan-semantic-eval-staging`. It may reuse the pinned processing service
identity and container image, but it has no Scheduler trigger and its fixed
command is `python embed_runner.py --query-file <frozen-file>`. The scheduled
`suluan-processing-staging` Job remains extraction-only.

The evaluation runner claims an entire suite before calling Gemini, embeds up
to 20 queries in one `batchEmbedContents` request, and posts the exact vector
set once. The Worker enforces corpus completeness, one active claim, quota
reservation, visibility-aware ranking, and private R2 artifact persistence.
This avoids overlapping scheduler executions, duplicate paid calls, and
stdout-only evidence. The Gemini secret is attached only to the dedicated
evaluation Job; the public Worker remains unconfigured for direct Gemini calls.

Staging activation completed on 2026-10-07: migration `0012` was applied through
the direct Neon endpoint, Worker version
`246a3cbd-7560-4684-b31e-a74923073fdb` was deployed, and the dedicated Job was
created by immutable digest with one task, parallelism one, zero retries, no
secret, and no Scheduler binding. The extraction Scheduler still targets only
`suluan-processing-staging`.

Quota-free execution `suluan-semantic-eval-staging-jp9zs` reached the Worker
with the expected workload identity and verified the frozen 16-query source
hash, 39 eligible records/1,227 chunks, zero missing embeddings, zero unindexed
records, and corpus snapshot
`603a92476dff09f45cfdd081fb5949e3e2753ce4646eefc11900097a1eb21bcc`.
It exited nonzero because quota headroom was intentionally part of readiness and
the earlier invalid run had already consumed 20/20 requests. Database evidence
remained 20 requests/20 inputs with zero active evaluation claims, proving that
preflight created no claim and consumed no quota. This is a successful
fail-closed smoke test, not a scored semantic evaluation.

No paid evaluation may run merely because the Job exists. Wait for quota reset
and the completed legacy corpus, rerun preflight against that final snapshot,
then attach the Gemini key only for the bounded manual execution.

The isolated evaluator image with quota-free `--preflight` support was built
without executing it on 2026-10-07:

- Cloud Build: `e2429d27-a87e-4eaa-80c2-faf5ee710c6a`
- tag: `semantic-eval-preflight-20261007`
- immutable digest:
  `sha256:bf4fcc89fe91c101e5c2fe6df6726cd36a20cacb32f7d7d9827a81da79e0b741`

Deploy the dedicated Job by digest, never by the mutable tag.

On 2026-10-10 the evaluator was rebuilt at immutable digest
`sha256:1d3212d2bcd24451a8909c0dcb8dd645cc14b3f88f26f0ad399feba659ac49ab`
to support bounded slices of the registered 25-query holdout. The Job was
restored to adviser-suite `--preflight` with no Gemini secret after the two
diagnostic batches.

## Full-corpus document embedding operations — 2026-10-08

After the 139-paper legacy corpus was accepted, extracted, and indexed, the
manual `suluan-embed-staging` Job was repinned to the same immutable processing
image digest used by the evaluator. Unlike the evaluator Job, it retains the
staging Gemini secret and runs document claims only. Obsolete
`SULUAN_QUERY_FILE`/`SULUAN_QUERY_INTERVAL` values were removed, and
`SULUAN_MAX_CLAIMS=1` enforces one provider request per execution. The Job has
one task, parallelism one, and zero retries; it was scheduler-free during the
manual backfill.

The staging document-embedding Job is now automated separately: Cloud Scheduler
job `suluan-embed-trigger` invokes `suluan-embed-staging` every three hours in
UTC. It uses the existing least-privilege processing Scheduler identity, which
has `roles/run.invoker` on this Job only. The Job remains one task with
`SULUAN_MAX_CLAIMS=1`, zero task retries, and the Worker-enforced shared quota;
the query evaluation Job remains scheduler-free and keyless.

Production uses the same bounded document-only pattern as of 2026-10-21.
`suluan-embed-production-trigger` invokes `suluan-embed-production` every two
hours (`0 */2 * * *`, UTC) with the production Scheduler identity granted resource-scoped
`roles/run.invoker`. The Job remains one claim/execution, zero task retries,
and subject to the production 20-request/2,000-input daily document ceiling.
When no accepted/current-index chunks lack vectors, claim returns before quota
reservation and the Job makes no Gemini request.

One canary plus 19 executions were paced by at least 30 seconds. All 20 claims
completed exactly once (395 inputs; some paper-bounded claims contained fewer
than 20 chunks), increasing coverage from 1,227 to 1,622 vectors. The daily
request ceiling then stopped work with 3,712/5,334 chunks missing. Continue on
later UTC days without changing the quota. Do not repurpose this document Job
for the frozen query suite; evaluation remains isolated in
`suluan-semantic-eval-staging`.

The owner then approved a temporary staging request-limit revision after the
provider dashboard confirmed 100 RPM, 30K TPM, and 1,000 RPD for Gemini
Embedding 1. Worker `679e15f5-efa1-4085-9927-2505d1709cde` raised only the
request ceiling to 110/day; the 2,000-input ceiling and every Job safeguard
remained unchanged. Another 81 paid executions completed once. The next
execution received no claim/quota increment, stopping at 101 requests/1,992
inputs with 3,219/5,334 chunks embedded and no active claim. Revert the two
explicit staging overrides after complete document coverage and the isolated
evaluation, or by 2026-10-15. Production keeps the code-owned defaults.

Final-day accounting found that the remaining 2,115 chunks across 62 papers
need at least 133 paper-bounded document claims; the frozen suite needs one
additional request and 16 inputs. The owner therefore approved a superseding
staging-only ceiling of 145 requests/2,200 inputs. Worker
`ef9619d3-abd7-4e88-8f11-21c25458284e` deployed it. Quota-free evaluator
preflight `suluan-semantic-eval-staging-w5mt9` confirmed those limits, the
unchanged frozen-query hash, 178 records/5,334 chunks, zero unindexed records,
and 2,115 missing embeddings. Its expected `ready: false` spent no quota.
Complete and verify document coverage before running the isolated evaluation,
then revert the overrides and detach its Gemini secret immediately.

## Configuration contract

Worker deployment configuration:

```ini
PROCESSING_SERVICE_AUDIENCE=https://the-deployed-worker-origin.example
PROCESSING_SERVICE_ACCOUNT=suluan-processing@PROJECT_ID.iam.gserviceaccount.com
```

Cloud Run Job environment:

```ini
SULUAN_API_BASE=https://the-deployed-worker-origin.example
SULUAN_WORKER_AUDIENCE=https://the-deployed-worker-origin.example
SULUAN_MAX_JOBS=5
```

The two audience values must be identical. Identifiers are configuration rather
than secrets, but production values belong in deployment configuration. Never
create or download a JSON service-account key.

## Code and local verification

- `services/processing/cloud_runner.py` is the bounded job entry point.
- `services/processing/Dockerfile` runs as a non-root user on Python 3.13.
- `apps/worker/src/auth.ts` verifies Google workload identity separately from
  Firebase user identity.
- `apps/worker/src/processing.ts` owns the claim-scoped internal API.

Run the credential-free checks from the repository root:

```powershell
npm run check
services/processing/.venv/Scripts/python.exe -m unittest discover -s services/processing -v
```

## Activation gate and order

Do not execute deployment commands until each gate is confirmed:

1. Recheck official Cloud Run Jobs, Artifact Registry, build, logging, and
   Scheduler pricing for the selected region. Region is `asia-southeast1`
   for this development activation.
2. Confirm the development Google/Firebase project and institutional ownership.
3. Attach billing and create/verify the PHP 250 monthly budget alert first.
   Done for dev on 2026-10-03.
4. Install and authenticate `gcloud`; enable only the APIs actually needed.
5. Create a dedicated `suluan-processing` service account with no project roles
   beyond those demonstrably required. Configure the Cloud Run Job to run as it.
6. Build the container and create the Job with one task, no automatic retries,
   `SULUAN_MAX_JOBS=5`, and the three environment values above.
7. Configure the matching Worker audience/account values and deploy the Worker.
8. Execute one manually queued development fixture. Verify claim audit, private
   download, extraction result, replay behavior, and abandoned-lease recovery.
   Done 2026-10-03 (`suluan-processing-lssfx` → `Full text searchable`).
9. Only after that check, choose a bounded schedule. Staging's approved
   development schedule is 15 minutes, with one task, no Cloud Run task retry,
   and database lease recovery. Production frequency, alerting thresholds,
   and institutional ownership remain TBD. Development manual execution
   remains the approved trigger.

Official references checked 2026-10-03: Cloud Run service identity documents the
metadata-server audience-bound ID-token flow; Cloud Run Jobs supports a dedicated
service identity; Cloud Run pricing lists a monthly Jobs free tier but applies it
as a billing-account discount. Recheck those pages at activation time.
