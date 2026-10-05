# Stage 5 pilot test design

## Status and scope

Stage 5 design is complete as of 2026-10-04. This document defines the
authorized, reproducible 40-document pilot that will be executed only after an
isolated staging environment exists. It does not authorize a staging or
production deployment, automatic scheduling, OCR, semantic embedding, or a
change to the current development limits.

The pilot covers upload, individual review, acceptance, private download,
bounded extraction, keyword preparation, discovery, and controlled extraction
failures. Stage 7 adds the broader authorization, leakage, interruption, lease,
and recovery matrix before Stage 8 executes the corpus at scale.

## Corpus

The corpus has 40 fixtures:

- **P01–P36:** authorized papers selected from the 139-paper legacy corpus.
  There are 18 PDFs and 18 DOCX files across all 15 courses represented in the
  source corpus. The selection includes every observed `PAGES_WITHOUT_TEXT`
  paper, source-size and extracted-text extremes, and the highest-page-count
  PDFs.
- **F01–F04:** generated, non-sensitive failure fixtures produced by
  `services/processing/pilot_fixtures.py`.

`docs/pilot-corpus-manifest.csv` is the authoritative selection. SHA-256 is the
cross-environment identity; development record IDs are locators only and must
not be reused as staging identifiers.

The paper selection is the union of:

1. the median-size paper in each represented course;
2. all six papers that produced `PAGES_WITHOUT_TEXT`;
3. the five largest and three smallest source files;
4. the three largest and three smallest extracted-text outputs; and
5. the three highest-page-count PDFs.

Union and de-duplication yield 36 papers. Re-running selection is unnecessary;
the committed hashes freeze the approved set.

### Controlled P33 baseline revision — 2026-10-05

Before Stage 8 upload, the authorized source folder matched 35 of the 36
original hashes. P33's current DOCX was 14 bytes larger than the Stage 5 copy.
The pinned production extractor returned the unchanged baseline of 29,720
characters with no warnings, and its course, format, and coverage role were
unchanged. The owner approved proceeding with the recommended reviewed
revision: P33 now records SHA-256 `b477af93fedf1b04528c5059cff5938e4527460b99c22307198390e5eae95054`
and 1,139,016 bytes. This is an explicit manifest revision under the stop rule
below, not a silent substitution; all other expected values remain fixed.

## Privacy and authorization review

- The owner previously authorized the 139-paper source corpus as publicly
  usable. The pilot uses only 36 members of that corpus plus generated data.
- The repository manifest intentionally omits titles, authors, filenames, and
  extracted text. It stores hashes, development locators, academic categories,
  sizes, and aggregate parser outcomes only.
- Original documents remain outside Git. Copy them into staging only by
  matching SHA-256 from the authorized source folder.
- The generated fixtures contain no personal or institutional content.
- Completed logs must never contain document text, Firebase tokens, service
  credentials, signed URLs, or raw parser exceptions. Use stable error codes.
- Staging must use separate Neon, R2, Worker, Firebase, and Cloud Run resources;
  do not execute this plan against production or reuse development records.

Authorization or hash uncertainty is a stop condition. Do not substitute a
similar paper silently; revise the manifest through review instead.

## Generated failure fixtures

Generate F01–F04 into an ignored or temporary directory:

```powershell
services/processing/.venv/Scripts/python.exe services/processing/pilot_fixtures.py `
  --output C:\Users\Lims\AppData\Local\Temp\opencode\suluan-pilot-fixtures
```

| ID | Case | Expected terminal result |
|---|---|---|
| F01 | Raster-only PDF with no text layer | `FAILED / NO_EXTRACTABLE_TEXT` |
| F02 | Malformed bytes with a PDF header | `FAILED / INVALID_DOCUMENT` |
| F03 | AES-256 password-protected PDF | `FAILED / ENCRYPTED_DOCUMENT` |
| F04 | Invalid ZIP payload declared as DOCX | `FAILED / INVALID_DOCUMENT` |

Failure is the expected safe outcome. A failed extraction must not undo the
accepted review decision, create a keyword snapshot, create embeddings, or
make document text searchable.

## Execution protocol

### Before execution

1. Complete the Stage 6 staging exit gate and identify the environment in the
   result log.
2. Verify all P01–P36 source hashes before upload. Record a mismatch and stop;
   do not upload the mismatched file.
3. Generate F01–F04 and run the processing unit suite.
4. Confirm semantic preparation is disabled and Scheduler is absent.
5. Copy `docs/pilot-result-log.csv` to the approved evidence location and give
   the run a unique UTC-based `run_id`.

### Run

1. Upload each fixture through the normal Worker submission route. Use a
   dedicated pilot marker in test-only metadata or operator notes; do not add a
   privileged import path.
2. Confirm every submission remains `PENDING` until an authorized manager makes
   an individual decision.
3. Accept each fixture using the intended visibility. Do not bulk-update Neon.
4. Run the bounded Cloud Run Job manually until there are no claimable jobs.
   Record every execution name and timing outside the document rows if needed.
5. Prepare keyword snapshots in bounded batches. Expected failure fixtures must
   remain without snapshots.
6. Verify authorized downloads byte-for-byte. Exercise anonymous and UA-only
   access according to each record's chosen visibility; Stage 7 owns the full
   denial matrix.
7. Run at least 12 keyword probes: both formats, every school represented in
   the selected corpus, all size/text extremes, and all six mixed-text papers.
   Choose one non-sensitive phrase from each paper during authorized review and
   record it only in the approved evidence location. Add five clean-negative
   probes expected to return no matching pilot record.
8. Repeat preparation and completion calls needed to demonstrate idempotency;
   do not retry provider calls or enable semantic preparation.

## Pass thresholds

All thresholds are required unless marked informational.

### Zero-tolerance gates

- No pending or rejected paper is discoverable or downloadable outside its
  authorized intake path.
- No unauthorized restricted/UA-only download succeeds.
- No source hash changes between authorized input and downloaded output.
- No duplicate submission, research record, processing job, keyword snapshot,
  or chunk set is created by a replay.
- No semantic snapshot, document embedding, or Gemini preparation call is
  created by this pilot.
- No secret or document text appears in the committed manifest or result log.

Any zero-tolerance failure fails the pilot immediately.

### Document outcomes

- **36/36** authorized papers finish `EXTRACTED` and receive exactly one current
  keyword snapshot.
- **30/30** ordinary papers have no extraction warning.
- **6/6** mixed-text papers finish `EXTRACTED` with exactly
  `PAGES_WITHOUT_TEXT`; the warning is not converted into failure or ignored.
- **4/4** generated fixtures finish with their exact expected stable error code
  and have zero keyword snapshots/chunks.
- **36/36** successful papers have non-empty extracted text, the expected
  parser family, and the baseline page count/warnings in the manifest. With the
  pinned parser versions, extracted character counts must match the baseline;
  any drift is investigated rather than rounded away.
- **36/36** successful papers report `READY` after keyword preparation and can
  be downloaded by an authorized manager with matching SHA-256.

### Discovery and operations

- **12/12** positive keyword probes return the intended pilot paper on page 1
  with `READY` and a non-empty, bounded snippet.
- **5/5** clean-negative probes return no pilot paper.
- No job remains `QUEUED` or `PROCESSING` after the final bounded run and lease
  recovery window.
- Repeating completion and keyword-preparation operations changes no terminal
  result and creates no duplicate rows.
- Duration, Cloud Run execution count, bytes, warning count, and failure count
  are recorded. They are informational in Stage 5 because production SLA and
  institutional cost ceilings remain TBD.

## Result log

Use `docs/pilot-result-log.csv` as the row-level template. One row represents
one fixture in one run. Use ISO 8601 UTC timestamps, booleans `true`/`false`,
pipe-separated stable warning codes, and blank fields for non-applicable data.

Do not overwrite expected values after a run. Record actual values separately,
then add a concise redacted run summary under a later Stage 8 evidence document.
Retain detailed operational logs only in the institutionally approved evidence
location once retention policy exists; that policy remains TBD.

## Exit decision

Stage 5 exits because the selected set is authorized, fixed by hash,
privacy-reviewed, reproducible, and covers normal, large, mixed-text,
image-only, malformed, and encrypted documents with explicit expected outcomes
and pass thresholds. Execution remains gated on Stages 6 and 7.
