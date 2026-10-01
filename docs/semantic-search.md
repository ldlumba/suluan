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
2. **Keyword preparation** — "Prepare extracted papers for search" splits the
   text into 2,000-character chunks and stores them with a full-text index.
3. **Embedding** — "Embed papers for semantic search" sends each chunk to Gemini
   `gemini-embedding-001`, which returns a 768-dimension vector. The vector is
   normalized and stored in `document_embeddings`, one row per chunk.
4. **Search** — your question is embedded as a `RETRIEVAL_QUERY` and compared
   against every stored vector using cosine distance. Chunks of the same paper
   are grouped, so a paper appears once with its closest chunk as the snippet.

Step 3 is **manager-only** and is an operator action, like step 2. Step 4 is
public and open to signed-out visitors.

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
2. On `/search`, run **Prepare extracted papers for search** until the batch
   reports complete. This creates the chunks.
3. Run **Embed papers for semantic search**. It reports how many chunks were
   embedded from how many papers. Run it again until it reports no more.
4. Click **Semantic**, search for a topic in your own words rather than a title.
   You should get relevant papers even without matching keywords.
5. Switch back to **Keyword** and confirm word-based matching still works.
6. Sign out and repeat step 4 in a private window. Anonymous visitors get public
   papers only, and results should still work.
7. Accept a paper as **Restricted**, embed it, and confirm it never appears for
   you while signed out.

## Limits and behavior

- **Daily development cap: 20 requests and 2,000 chunks per day.** One thesis is
  roughly 25–50 chunks, so this is about 40 papers a day. The limit resets on
  the UTC day. When it is reached, semantic search falls back to keyword results
  and says so — it does not error.
- **Cost is currently zero** because the project uses the Gemini free tier. If
  billing is ever enabled, embedding costs about US$0.002 per thesis. Enabling
  billing also requires creating the agreed ₱250/month billing alert, and it is
  the same gate that must be cleared before Cloud Run.
- **No vector index yet.** Search scans every stored vector, which is exact and
  instant at this size. Revisit only with real row counts.
- **Embeddings are per extraction.** Re-extracting a paper produces a new
  chunk snapshot, which needs a new embedding batch. A changed chunker version
  likewise requires re-embedding.
- **Restricted papers are embedded too**, but stay hidden in results. Access is
  a read-time decision, so lifting an embargo needs no re-embedding.

## Known limits

- Semantic results only cover papers that have been extracted, keyword-prepared,
  **and** embedded. Anything else appears in keyword mode only.
- Queries are capped at 200 characters, same as keyword search.
- Semantic search is not the assistant. It returns ranked papers, never an
  answer, and only from ACCEPTED content.