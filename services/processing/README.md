# Local document processing

This is the local, operator-driven extraction slice. Cloud Run deployment,
authenticated service-to-service delivery, automatic queue consumption, OCR,
indexing, and embeddings are deferred. No cloud service is activated by setup.

## Setup (from repository root, PowerShell)

```powershell
python -m venv services/processing/.venv
services/processing/.venv/Scripts/python.exe -m pip install -r services/processing/requirements.txt
services/processing/.venv/Scripts/python.exe -m unittest discover -s services/processing -v
```

The Python suite is separate from `npm run check`; run both for processing changes.
Dependencies are isolated in the ignored venv. Python 3.13 is the verified local version.

## Process an accepted paper

1. Run `npm run dev:worker` and `npm run dev`. Sign in as ADMIN or REPOSITORY_MANAGER.
2. Accept a submission. Acceptance atomically creates one `QUEUED` job.
   Migration 0004 also queues pre-existing accepted records without parsing them.
3. In browser DevTools → Network, select a successful authenticated API request
   (e.g. `/api/me`). Copy only the token portion after `Bearer` from its
   Authorization header. Treat it as a temporary password: do not share it,
   paste it into chat, or commit it. It expires; use a fresh token when needed.
4. List jobs with the command below. Paste the token into its hidden prompt.

```powershell
services/processing/.venv/Scripts/python.exe services/processing/runner.py
```

Then process one job using its UUID (not the submission UUID):

```powershell
services/processing/.venv/Scripts/python.exe services/processing/runner.py --job <job-uuid>
```

The runner claims the job, downloads its submission through the Worker, parses
in a bounded subprocess, and posts the result with the claim token. An optional
process-scoped `SULUAN_ID_TOKEN` environment variable avoids repeated prompts;
the CLI does not accept tokens as command-line arguments. Only localhost origins
are accepted; redirects are rejected to avoid forwarding credentials.

Failed jobs require explicit retry:

```powershell
services/processing/.venv/Scripts/python.exe services/processing/runner.py --job <job-uuid> --retry
```

`NO_EXTRACTABLE_TEXT` means manual attention is needed (often a scanned or blank
document), not proof that OCR would succeed. Retrying the same scanned file will
not add OCR. Encrypted, malformed, and over-limit files have separate error codes.
Mixed PDFs can succeed with `PAGES_WITHOUT_TEXT`; DOCX extracts body paragraphs
and tables, not headers, footnotes, images, or a reliable page layout.

## Durability and boundaries

- Pending/rejected submissions never get processing jobs. Worker routes require
  a current manager role and recheck acceptance before claim/retry/completion.
- Concurrent claims are atomic; expired 10-minute claims can be reclaimed.
  Stale attempt results are rejected. Identical completion retries are harmless.
- Extraction failures cannot reverse acceptance. Result text, SHA-256 of source
  bytes, parser version, page count, and warnings are stored in Neon as restricted
  operational data. Source documents remain in private R2.
- A parser timeout/crash reports failure. A runner/network crash may leave the
  job PROCESSING until its lease expires; rerun the same job after expiry.
- Storage mode matters: local R2 and remote R2 have different contents, while
  this development setup uses the same Neon DB. Run against the same mode used
  to upload the file. Missing objects fail instead of being replaced or fabricated.
- No extracted text is exposed in listing responses, logs, search, or AI evidence.
- This local manager-token adapter is not the future Cloud Run service identity.
  Cloud deployment needs a separate authenticated delivery design and cost review.

## Pace semantic preparation

After extraction and keyword preparation, use the same manager token through the
process-scoped `SULUAN_ID_TOKEN` variable to prepare missing semantic vectors:

```powershell
services/processing/.venv/Scripts/python.exe services/processing/semantic_prepare.py
```

The command makes one manager-authorized Gemini request for at most 20 chunks,
waits 30 seconds, and repeats. It stops when preparation is complete, the Worker
reports its daily development cap, or 20 batches have run. A provider error or
429 stops immediately: it is never retried automatically because each attempt
may consume quota. Existing vectors remain intact, so rerunning later resumes
only missing chunks. The command accepts localhost Worker origins only and never
accepts the Firebase token as a command-line argument.

## Evaluate semantic relevance

Once every chunk has a vector, restart the Worker and run the labeled evaluation
with a fresh manager token in `SULUAN_ID_TOKEN`:

```powershell
services/processing/.venv/Scripts/python.exe services/processing/semantic_relevance.py
```

The 25 probes in `semantic_relevance_queries.json` include positive, adjacent
hard-positive, and clean-negative queries. Each semantic query is one paid input;
the command waits three seconds between calls, never retries a failure, and stops
if the Worker reports anything other than `semanticStatus: ready`. It also runs
the free keyword path and computes semantic, keyword, and reciprocal-rank-fusion
metrics. The report includes distance and margin distributions plus a diagnostic
for closest-chunk length bias; it does not automatically change production
thresholds or ranking.

Sanitized results are written to `logs/semantic-relevance.json`, which is ignored
by Git and checkpointed after every completed probe, so a later failure does not
discard earlier paid results. Extracted snippets and credentials are never
written or printed. Review the report before recording any conclusions. The
temporary evaluation cap was restored to 20 requests/day after the 2026-10-02
run; repeating all 25 probes therefore requires a separately approved window.

## Cloud Run Job preparation

`cloud_runner.py` and the adjacent `Dockerfile` implement the approved bounded
pull design for a future Cloud Run Job. The job uses its metadata-server Google
ID token to claim work through Worker-only endpoints; it receives no Neon, R2,
Firebase-manager, or service-account-key credential. See
`docs/cloud-run-processing.md` for the identity contract and activation gates.

This code is locally tested but **not deployed**. Billing, the PHP 250 budget
alert, project/region selection, Google APIs, service account, image registry,
Cloud Run Job, and schedule are still activation work. Do not treat the checked-
in Dockerfile as proof that any cloud resource exists.
