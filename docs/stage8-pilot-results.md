# Stage 8 bounded corpus pilot results

## Decision

Run `20261005T103129Z` completed the approved staging corpus protocol on
2026-10-05. The **keyword/extraction pilot passed**. The separately frozen
semantic gate **failed closed on provider availability** and semantic remains
disabled. No result below authorizes production deployment, OCR, automatic
Cloud Run scheduling, or assistant use.

Detailed row-level evidence remains outside Git in the approved temporary
evidence directory. This document contains aggregate outcomes only—no document
text, private file paths, tokens, credentials, or raw provider secrets.

## Corpus and workflow

- 36 authorized papers (18 PDF, 18 DOCX) plus four generated safe-failure
  fixtures; 197,082,153 source bytes (187.95 MiB).
- P33 used the reviewed baseline revision recorded in the manifest. All 36
  source hashes matched before upload.
- Importer dry-run: 40 ready, zero skipped/errors/warnings. Apply created 40
  `PENDING` submissions; immediate replay returned the same 40 IDs.
- The staging manager made 40 individual accept decisions with remarks. P04
  was accidentally accepted `PUBLIC` rather than the planned `RESTRICTED` test
  visibility; this was recorded, not changed directly in Neon. The final pilot
  matrix was 34 PUBLIC successful papers, two UA_ONLY successful papers, and
  four RESTRICTED generated failure fixtures.
- Final relational counts: 40 submissions, 40 decisions, 40 repository records,
  and 40 processing jobs. All 80 notification outbox rows were processed and
  all 80 corresponding notification attempts were `SENT`.

## Extraction and recovery

- 36/36 papers reached `EXTRACTED`; hashes, pinned parser family, page counts,
  warnings, and exact character counts matched every baseline.
- 30/30 ordinary papers had no warning. All six mixed-text papers had exactly
  `PAGES_WITHOUT_TEXT`.
- F01–F04 failed safely with the exact expected distribution:
  `NO_EXTRACTABLE_TEXT` ×1, `INVALID_DOCUMENT` ×2, and
  `ENCRYPTED_DOCUMENT` ×1. Acceptance remained intact and no failed fixture
  received chunks or a keyword snapshot.
- Eight successful five-job Cloud Run executions processed the corpus. One
  intervening execution (`suluan-processing-staging-6q2qb`) failed before claim
  with a transient workload-auth 401; its token audience, service account,
  issuer, and expiry were correct. One explicit retry succeeded without loss or
  duplication. A final no-work execution (`suluan-processing-staging-zzp6m`)
  completed after the queue reached zero.
- The acceptance-to-final-terminal window was 588.806 seconds. This is an
  informational pilot measurement, not an SLA.

## Keyword discovery and access

- Four bounded preparation calls indexed 10 + 10 + 10 + 6 papers. Final state:
  exactly 36 keyword snapshots and 1,224 chunks. A replay indexed zero.
- 21/21 coverage probes (both formats, every represented school, every selected
  size/text/page extreme, and all six mixed-text papers) returned the intended
  pilot paper at rank 1 on page 1 with `READY` and a non-empty bounded snippet.
- 5/5 clean-negative probes returned no pilot record.
- Manager downloads matched the original SHA-256 for 40/40 fixtures. Anonymous
  downloads returned 200 for all 34 PUBLIC fixtures and the non-probing 404 for
  both UA_ONLY and all four RESTRICTED fixtures.
- No processing job remained `QUEUED` or `PROCESSING`; submission, extraction,
  and keyword-preparation replays created no duplicate domain rows.

## Semantic gate — failed closed

- Before Gemini activation, a new retrieval-blinded holdout was frozen: 20
  labeled positive/hard-positive queries plus five clean negatives, SHA-256
  `a93702be25a253edfc679bb754977db994840df1e858776ea0b21e3842f6cccb`.
  Queries were realistic metadata-only paraphrases and were not changed after
  retrieval began.
- The owner explicitly approved the provider's minimum US$5 prepayment with
  auto-reload off. Credits are non-refundable and expire after 12 months. Exact
  consumed cost was not yet posted because provider billing reports lag; server
  accounting stopped at 57 requests / 1,130 inputs, within the temporary
  100-request / 2,000-input limits.
- Two prepayment-required 402 responses and six provider failures wrote no
  vectors and were never automatically retried. The decisive recurring error
  was `400 FAILED_PRECONDITION: User location is not supported for the API use`.
  Calls through the same Cloudflare Worker alternated between success and this
  error, demonstrating that variable Worker egress cannot provide dependable
  Gemini availability for this route.
- Preparation stopped with 949 pilot vectors across 24 partial pilot semantic
  snapshots (950 vectors / 25 snapshots globally because one pre-existing
  staging smoke record was also eligible). The frozen ranking holdout was not
  run: availability had already failed the gate, and spending more quota could
  not turn an unreliable runtime path into production evidence.
- Partial snapshots are retained as explicit interrupted-run evidence and are
  recoverable by the existing missing-chunk logic; they grant no `INDEXED`
  status. The staging Gemini secret was deleted, the temporary quota override
  was removed, Worker `2c011e64-c464-47ea-b118-423ddd493e74` was redeployed,
  and the public semantic endpoint was verified `unconfigured`.

## Exit

Stage 8 exits with dependable keyword search and all corpus security,
idempotency, extraction, recovery, and access gates passing. Semantic retrieval
does **not** pass and must remain disabled. Any future attempt requires an
explicit architecture revision that supplies a supported, region-stable Gemini
execution path; do not solve this by automatic retries or by silently raising
quotas. Stage 9 institutional readiness and the approved metadata-only
Knowledge Graph may proceed without semantic retrieval.
