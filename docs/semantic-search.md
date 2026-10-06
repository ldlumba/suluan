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

The frozen 25-query holdout returned `semanticStatus: ready` for all 25 queries
through the pinned region, proving provider availability. It did **not** produce
valid relevance evidence: the frozen expected `[CORPUS]` records were absent
from the staging dataset, so none of the 15 positive targets could be scored,
while all five clean negatives still returned nearest papers. Semantic mode
remains unapproved and must stay disabled until the holdout is rerun against
the intended corpus (or an equivalently governed replacement).

## Known limits

- Semantic results only cover papers that have been extracted, keyword-prepared,
  **and** embedded. Anything else appears in keyword mode only.
- Queries are capped at 200 characters, same as keyword search.
- Semantic search is not the assistant. It returns ranked papers, never an
  answer, and only from ACCEPTED content.
