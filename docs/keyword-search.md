# Keyword search development preview

## Try it

1. Restart `npm run dev:worker` and keep `npm run dev` running.
2. Sign in as an ADMIN or REPOSITORY_MANAGER; click **Search** or open `/search`.
3. Search for a word from an extracted paper, its title, or an author.
   Leave the query blank to browse accepted papers. Use Previous/Next
   for pages of 10 papers. Quotes support phrase matching within a chunk.
   Accepted papers whose full text is not yet searchable still appear by
   title/author/year, labeled "Full text pending" or "Full-text processing
   failed", with no text excerpt.

No token-copying or Python rerun is required for papers already EXTRACTED.
New papers still need the local Python extraction step before preparation.
Keyword indexing runs automatically from the deployed Worker's five-minute
scheduled sweep. The manager-only `POST /api/search/index` endpoint remains an
incident/recovery escape hatch, but is not needed for normal operation.

## Scope

- Manager-only until publication/embargo rules are decided. Ordinary users and
  unauthenticated callers cannot index or retrieve results, snippets, or counts.
- PostgreSQL keyword search only. The `simple` configuration matches words
  without English stemming; semantic meaning/synonym matching is not supported.
- Searches title/author/year metadata and document chunks; returns one result
  per accepted paper. A non-empty query returns, for fully searchable papers
  only, a whitespace-normalized plain-text excerpt of the best matching chunk,
  trimmed at a word boundary (no HTML highlighting). Blank browse mode is
  metadata-only and never displays arbitrary document front matter. Papers pending
  extraction or preparation, or with failed extraction, appear metadata-only
  with an explicit status label; they never contribute snippets or keyword
  ranking, and pending/rejected submissions remain fully excluded.
- Source text is untrusted and rendered as React text, not injected HTML.
- Development chunker: 2,000 UTF-16 code units/window, 200-unit overlap, stable
  offsets into the original extracted text. These are characters, not model tokens.
  Long phrases spanning beyond the overlap may not match as one phrase.
- Every keyword snapshot records the extraction attempt token, source SHA-256,
  chunker version, and creation time. Concurrent duplicate requests create one
  snapshot. Chunks and their snapshot commit atomically. Failed preparation can
  be retried without re-extracting a document.
- Reads recheck acceptance/extraction and the current extraction token/version.
  Older snapshots are hidden when source processing changes; no automatic deletion
  policy is introduced. Stored snapshots do not imply publication permission.
- Migration 0005 enables the existing Neon database's pgvector extension, but does
  not add an embedding dimension, call a model, or create a vector index. Keyword
  readiness is separate from future semantic INDEXED/AI-evidence readiness.
- Search uses existing Neon compute/storage; no new paid plan is activated and
  no Gemini keys are required. This is not a guarantee of unlimited free usage.

## Verification

Run `npm run check`, `npm run db:check`, and `npm run build`.
Tests cover API authorization, idempotent concurrent preparation, metadata/text
matching, metadata-only visibility for pending/failed extraction, pending/rejected
exclusion, stale snapshot suppression, query bounds, Unicode chunk coverage,
and safe snippet rendering.

Future owner input: public visibility/embargo policy; Gemini model/dimensions,
data-processing approval and usage/spend limits; Cloud Run billing and delivery.
