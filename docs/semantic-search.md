# Semantic search

## What this is

Semantic search finds papers by meaning rather than keywords. A visitor types
"how does humidity affect solar output" and gets back a thesis about
photovoltaic efficiency in humid climates, even though those words never appear
together.

Keyword search still exists and is still the fallback. Semantic mode is a second
option on the same `/search` page.

## How it works

1. **Extraction** — a manager-accepted PDF/DOCX is turned into text by
   `services/processing` (`EXTRACTED`).
2. **Keyword preparation** — the Worker's five-minute scheduled sweep splits
   extracted text into 2,000-character chunks and stores it with a full-text
   index. `POST /api/search/index` remains a manager-only recovery escape hatch.
3. **Embedding** — "Embed papers for semantic search" sends each chunk to Gemini
   `gemini-embedding-001`, which returns a 768-dimension vector. The vector is
   normalized and stored in `document_embeddings`, one row per chunk.
4. **Search** — your question is embedded as a `RETRIEVAL_QUERY` and compared
   against every stored vector using cosine distance. Chunks of the same paper
   are grouped, so a paper appears once with its closest chunk as the snippet.
   A defensive `0.7` cosine-distance guardrail omits results above it, but it is
   not calibrated as a relevance boundary and currently filters no observed
   development results.

Step 3 is **manager-only** and remains an operator action while semantic search
is gated. Step 4 is public and open to signed-out visitors when semantic search
is configured and approved.

## What you need

A Gemini API key in `apps/worker/.dev.vars`:

```ini
GEMINI_API_KEY=AQ.your-key-here
```

That file is git-ignored. Never put the key in `wrangler.toml`, in the browser,
or in chat.

Keys created in AI Studio today start with `AQ.` and are tied to a service
account. That format is fine — the Worker talks to Google over plain HTTP, so
there is no SDK that might reject it.

## Manual checks

1. Start `npm run dev:worker` and `npm run dev`, then sign in as a manager.
2. Wait for the scheduled keyword-index sweep, or use the manager-only recovery
   endpoint if an incident requires immediate preparation.
3. Run **Embed papers for semantic search**. It reports how many chunks were
   embedded from how many papers. Each action makes one Gemini request for at
   most 20 chunks from at most two papers. Wait at least 30 seconds between
   actions, or use the paced operator command below. Run until it reports no
   more or the daily development cap stops the run.

   ```powershell
   services/processing/.venv/Scripts/python.exe services/processing/semantic_prepare.py
   ```
4. Click **Semantic**, search for a topic in your own words rather than a title.
   You should get relevant papers even without matching keywords.
5. Search for both covered and clearly unrelated topics. Record the returned
   paper order and distances; do not treat the current `0.7` guardrail as proof
   of relevance. Switch to **Keyword** and confirm word-based matching still
   works.
6. Sign out and repeat step 4 in a private window. Anonymous visitors get public
   papers only, and results should still work.
7. Accept a paper as **Restricted**, embed it, and confirm it never appears for
   you while signed out.

## Limits and behavior

- **Default development cap: 20 requests and 2,000 embedding inputs per UTC day.**
  The temporary 40-request relevance-evaluation window was completed and reverted
  on 2026-10-02. Document chunks and search queries are both inputs. When either
  limit is reached, semantic search falls back to keyword results and says so —
  it does not error.
- **Preparation does not burst provider calls.** One manager action maps to one
  synchronous Gemini batch (up to 20 chunks). The observed free-tier limits are
  100 requests/minute, 30K tokens/minute, and 1K requests/day; TPM, not RPM or
  RPD, was the binding provider limit during corpus seeding. Wait 30 seconds
  between calls. A provider failure writes no vectors and keeps existing vectors.
  A 429 is reported distinctly and is never retried automatically. The attempted
  call remains charged to the server-side quota because it may have consumed
  provider capacity.
- **Cost is currently zero** because the project uses the Gemini free tier. If
  billing is ever enabled, embedding costs about US$0.002 per thesis. Enabling
  billing also requires creating the agreed ₱250/month billing alert, and it is
  the same gate that must be cleared before Cloud Run.
- **No vector index yet.** Search scans every stored vector, which is exact and
  instant at this size. Revisit only with real row counts.
- **The distance guardrail is not a working relevance filter.** The current
  maximum cosine distance is `0.7`, but three initial probes against 42 vectors
  from two papers all clustered between `0.47` and `0.50`, including unrelated
  queries. It therefore filtered nothing, and even the relative order was not
  meaningfully topical. Keep it only as a defensive bound until a labeled,
  diverse SULUAN corpus can compare an absolute cutoff, relative/margin scoring,
  and hybrid keyword + vector retrieval. Keyword mode remains available for
  exact terms.
- **Closest-chunk scoring favors longer papers.** The current record score is
  the minimum distance over all its chunks. More chunks create more chances for
  a spuriously close match, so relevance evaluation must include papers with
  varied lengths rather than tuning only on similarly sized documents.

## Relevance evaluation — 2026-10-02

The reproducible 25-query run against 806 vectors completed successfully: 15
direct positives, five adjacent-topic hard positives, and five clean negatives.
The manager view was used so all labeled UA-only records were eligible.

- Semantic search ranked the labeled target first for **20/20 positive queries**
  (Hit@1, Hit@3, Hit@10, and MRR all `1.0`). It also beat the named adjacent
  paper in all **5/5** hard-positive contrasts.
- Keyword search found the labeled target for only **1/20** probes. Reciprocal
  rank fusion also scored `1.0`, but mostly inherited the semantic ordering; this
  run does not show an independent hybrid improvement.
- Positive target distances ranged from `0.1754` to `0.2733`. Clean-negative top
  results ranged from `0.3881` to `0.4260`, leaving an observed gap of about
  `0.1148`. The current `0.7` guardrail rejected none of those negatives.
- Top-result frequency versus expected-paper chunk count had Pearson `r=0.153`.
  That is weak in this sample, but does not rule out length bias: one 61-chunk
  influenza paper was the nearest result for four of five unrelated queries.

This validates semantic **ranking behavior in the curated development corpus**,
not a production abstention threshold. The apparent best cutoff (`0.2733`) was
selected and scored on the same small, topic-informed query set with only five
clean negatives. Keep `MAX_SEMANTIC_DISTANCE = 0.7` as a defensive bound only;
do not promote semantic mode to production until an independent/blinded holdout
with realistic user phrasing validates a cutoff and tests false positives. Raw
sanitized results remain local in the Git-ignored `logs/semantic-relevance.json`.

- **Embeddings are per extraction.** Re-extracting a paper produces a new
  chunk snapshot, which needs a new embedding batch. A changed chunker version
  likewise requires re-embedding.
- **Interrupted batches are repairable.** Preparation selects missing chunks,
  not missing papers. Running the embed action again keeps existing vectors and
  writes only the missing ones; it never needs to delete and re-embed a paper.
- **Restricted papers are embedded too**, but stay hidden in results. Access is
  a read-time decision, so lifting an embargo needs no re-embedding.

## Region-stable retry — 2026-10-06

The pinned `asia-southeast1` Cloud Run embedding Job completed the remaining
staging backfill: 1,224/1,224 expected pilot chunks became embedded, and a
follow-up claim reported no remaining chunks. A temporary, hard-bounded staging
window (`200` requests / `4,000` inputs) was used because the reset-day staging
bucket had already been consumed; both overrides were removed and the Worker
was redeployed immediately afterward. The default code-owned cap remains
20/2,000.

The correct frozen 25-query staging holdout is now versioned as
`services/processing/semantic_holdout_queries.json` with the registered SHA-256
above. Through the pinned region, all 25 queries returned `semanticStatus:
ready`; the 15 positive and five hard-positive targets all ranked first. The
five clean negatives also all returned nearest papers, at distances
`0.405–0.458`, so the current retrieval path has no safe abstention behavior.
Semantic mode remains unapproved and disabled.

## Interim adviser-approved evaluation gate — 2026-10-07

Before the one-run evaluation, the owner approved this preregistered policy for
the current 43-record staging corpus:

- record score: existing `MIN` distance across a paper's chunks;
- abstention floor: return no semantic result when the score is greater than
  `0.38`;
- no margin or alternate aggregator is used for the primary gate.

Primary pass criteria:

- seven direct/concept positive cases: expected paper ranked first, `7/7`;
- four boundary cases: expected winner beats its named contrast, `4/4`;
- one multi-result farming case: both expected papers appear;
- four clean-negative cases: all abstain, `4/4`.

This is explicitly an **interim** gate because staging currently contains 43
accepted records rather than the planned legacy corpus. A pass does not enable
production semantic search or establish that `0.38` generalizes to the larger
corpus. A failure remains a useful result and keeps semantic disabled.

### 2026-10-07 attempt — invalid, not scored

The first execution was not a valid evaluation. The manual Cloud Run execution
overlapped the enabled 15-minute staging extraction scheduler after the Job was
temporarily repointed to the evaluation command. Both executions claimed
queries, the daily quota reached its 20-request limit, and neither produced a
complete persisted evaluation artifact. The staging Job was restored to the
normal extraction image and command, with the Gemini secret removed. This
attempt supplies no ranking or abstention evidence and must not be counted as a
pass or failure of the preregistered gate. The gate remains pending a fresh
quota day with the scheduler paused during the bounded run.

### Evaluation isolation and batching — implemented, live activation pending

The failed run exposed two avoidable process defects: a scheduled extraction
Job was temporarily reused for evaluation, and the frozen suite used one paid
provider request per query. The replacement path fixes both before another run:

- `POST /api/internal/embeddings/evaluation/claim` accepts 1–20 frozen probes,
  verifies that every eligible current-snapshot chunk has the approved model
  embedding, reports extracted records missing keyword indexes, computes a
  deterministic corpus snapshot hash, and reserves **one request plus N
  inputs** from the server-side quota;
- `POST /api/internal/embeddings/evaluation/preflight` performs the same corpus,
  model, query-count, workload-identity, and quota-headroom checks without
  creating a claim, consuming quota, requiring a Gemini key, or calling Gemini;
- a database partial unique index permits only one unused evaluation claim;
- `embed_runner.py --query-file` sends the whole suite in one Gemini
  `batchEmbedContents` call with `RETRIEVAL_QUERY` rather than one call per
  probe;
- the result endpoint validates the exact probe set and vector geometry,
  computes all visibility-aware rankings/distances, and writes one sanitized
  immutable JSON artifact under private R2
`operations/semantic-evaluations/<run-id>.json`;
- normal logs receive only the run/artifact hashes and counts. Full vectors and
  distance arrays no longer need to be reconstructed from Cloud Logging.

The evaluation runs from a separate, manually invoked
`suluan-semantic-eval-staging` Cloud Run Job with no Scheduler binding. The
existing `suluan-processing-staging` extraction Job must never again be
repointed. Migration `0012`, Worker version
`246a3cbd-7560-4684-b31e-a74923073fdb`, and the digest-pinned Job were activated
in staging on 2026-10-07. Quota-free execution
`suluan-semantic-eval-staging-jp9zs` authenticated and verified the frozen
16-query hash, 39 eligible records/1,227 chunks, zero missing embeddings, zero
unindexed records, and corpus snapshot
`603a92476dff09f45cfdd081fb5949e3e2753ce4646eefc11900097a1eb21bcc`.
It correctly reported `ready: false` solely because the earlier invalid run had
already consumed 20/20 daily requests. Usage stayed at 20 requests/20 inputs,
no evaluation claim was created, and Gemini was not configured or called. This
is activation evidence only; the frozen adviser suite is not rerun until quota
has reset and the completed legacy corpus is frozen.

### Chunking audit — 2026-10-07

A content-free aggregate audit covered all 1,227 current staging chunks. Of
1,188 non-final chunks, 24 ended at sentence punctuation and 23 ended at a
newline; median and maximum length were both 2,000 characters. Eighty chunks
contained the word `references`. This confirms that v1 is a fixed window rather
than a section-aware academic-paper chunker.

The current `chars-2000-overlap-200-v1` strategy remains frozen for the governed
pilot. Its 200-character overlap preserves context across hard boundaries, and
the same version already produced 20/20 development Hit@1; changing it now
would invalidate that baseline and require an unvalidated full re-embedding.
Section-aware boundaries, title/heading prefixes, and reference exclusion are
explicit candidates only if the completed-corpus evaluation identifies a
failure attributable to chunking. They must be compared as a new version, not
silently substituted after observing the frozen results.

### Full-corpus staging progress — 2026-10-08

The authorized legacy importer created 139 staging submissions after a clean
dry-run (139 ready, 18 intentional skips, zero errors/warnings). Immediate
replay returned the same 139 IDs with zero duplicates. The manager subsequently
completed 139 individual acceptances. Bounded extraction produced 139/139
`EXTRACTED` with zero failures, and scheduled keyword indexing created 4,107
legacy chunks. The complete extractable staging corpus is now 178 records/5,334
chunks.

Document embedding day 1 used the manual scheduler-free Job pinned to digest
`sha256:bf4fcc89fe91c101e5c2fe6df6726cd36a20cacb32f7d7d9827a81da79e0b741`.
The Job was tightened to one claim per execution and 20 executions were paced
at least 30 seconds apart. All claims completed once, consuming 20 requests/395
inputs and bringing coverage to 1,622/5,334 chunks; geometry mismatches are
zero. The remaining 3,712 chunks require later UTC quota days under the
code-owned 20-request ceiling. The frozen evaluation remains prohibited until
coverage reaches 100%, preflight passes on the final snapshot, and one request
plus 16 inputs is reserved for the batch.

## Scoring workbench — 2026-10-06

The Worker now exposes an internal, service-authenticated evaluation option for
the pinned-region query claim: `includeDiagnostics: true` returns only record
IDs and per-chunk cosine distances. It never returns chunk text and is not part
of the public semantic response. `embed_runner.py --query-vectors-output` can
persist those distances and the query vectors together with the frozen
query-file SHA-256, so scoring experiments do not pay to re-embed the same
queries.

`services/processing/semantic_scoring.py` provides pure candidate aggregators
(`MIN`, fixed top-k mean, proportional top-k mean, and a length-penalized
control) plus explicit score-floor and margin abstention diagnostics. These are
evaluation primitives, not a production policy. The public Worker still uses
the existing defensive `MIN` path and remains disabled until a fresh labeled
holdout selects and verifies a scoring/abstention policy.

### Development distance artifact — 2026-10-06

The pinned staging Job execution `suluan-processing-staging-xgrvx` captured the
same frozen 25-query file after a bounded temporary quota window. The artifact
was verified with SHA-256
`a93702be25a253edfc679bb754977db994840df1e858776ea0b21e3842f6cccb`, contained
25/25 query vectors, and included 39 per-paper distance lists per query. The
temporary Worker limits were reverted immediately; the public semantic route
returned `semanticStatus: unconfigured` afterward, and the Job was restored to
the normal extraction image/command without a Gemini secret attachment.

Offline comparison on this development set found 20/20 positive Hit@1 and 5/5
negative abstention at conservative candidate floors, including the current
`MIN` control and top-k variants. This is directional only: the same set is now
development data, not a calibration or production gate. No scoring policy or
threshold was promoted.

## Known limits

- Semantic results only cover papers that have been extracted, keyword-prepared,
  **and** embedded. Anything else appears in keyword mode only.
- Queries are capped at 200 characters, same as keyword search.
- Semantic search is not the assistant. It returns ranked papers, never an
  answer, and only from ACCEPTED content.
