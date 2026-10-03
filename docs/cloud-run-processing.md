# Cloud Run document processing

## Status

The authenticated pull contract and container entry point are implemented and
locally tested. Nothing has been deployed: no billing account, budget alert,
Google API, Artifact Registry repository, Cloud Run Job, or Scheduler trigger
was created by this work.

Deployment stays blocked until the owner verifies current pricing, attaches the
approved development billing account, and creates the agreed **PHP 250 monthly
budget alert**. Free-tier allowances are not a guarantee of zero cost.

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
   Scheduler pricing for the selected region. Region remains **TBD**.
2. Confirm the development Google/Firebase project and institutional ownership.
3. Attach billing and create/verify the PHP 250 monthly budget alert first.
4. Install and authenticate `gcloud`; enable only the APIs actually needed.
5. Create a dedicated `suluan-processing` service account with no project roles
   beyond those demonstrably required. Configure the Cloud Run Job to run as it.
6. Build the container and create the Job with one task, no automatic retries,
   `SULUAN_MAX_JOBS=5`, and the three environment values above.
7. Configure the matching Worker audience/account values and deploy the Worker.
8. Execute one manually queued development fixture. Verify claim audit, private
   download, extraction result, replay behavior, and abandoned-lease recovery.
9. Only after that check, choose a bounded schedule. Scheduler frequency,
   retry/dead-letter policy, region, and observability thresholds remain TBD.

Official references checked 2026-10-03: Cloud Run service identity documents the
metadata-server audience-bound ID-token flow; Cloud Run Jobs supports a dedicated
service identity; Cloud Run pricing lists a monthly Jobs free tier but applies it
as a billing-account discount. Recheck those pages at activation time.
