# SULUAN Knowledge Graph — design v1

Owner direction 2026-10-05: metadata entity graph, not a citation network.
Plan now; build only after the Stage 7 reliability/security exit gate, on the
Stage 8 corpus (the first dataset with testable structure). No new
infrastructure: reads come from existing Neon tables, rendering uses React
Flow (already in the locked frontend stack). A graph database would violate
the locked stack and is not proposed.

Implementation status (2026-10-05): the discovery slice is implemented as a
paper-centered, depth-1/2 neighborhood at `GET /api/graph/neighborhood` and the
public `/graph` React Flow view. Search results link into the graph. The
aggregate slice is implemented at `GET /api/graph/counts` and
`/graph/analytics`, with bounded keyword/course/year counts plus top keyword
pairs computed per viewer.

## 1. What the graph is and is not

The graph answers entity-relationship questions over repository metadata:

- "What else is tagged with this method or topic?"
- "Who works with whom?" (co-authorship)
- "Where is UA research concentrated?" (keyword/course/year aggregates)
- "How did topics shift over time?"

It does NOT answer citation questions ("who cited whom?", "what is the
literature chain for this claim?"). Citation edges are explicitly out of v1
(see §6). It also does NOT fuse semantic vectors in v1; graph structure and
embedding similarity stay independent until Stage 8 produces a relevance
harness that could justify combining them.

## 2. Node and edge types (all derivable from the current schema)

| Node | Source | Identity |
|---|---|---|
| Paper | `research_records` (ACCEPTED only) | record id |
| Author | `record_authors` | normalized name (lowercase/trim; same dumb rule as keywords v1, documented identically) |
| Keyword | `keywords` | `normalized_name` (already deduped) |
| Course | `courses` | id |
| School | `schools` | id |
| Year | `research_records.year` | integer (attribute, promoted to node for time queries) |

| Edge | Source | Notes |
|---|---|---|
| Paper —AUTHORED_BY→ Author | `record_authors` (+ position) | |
| Paper —TAGGED_WITH→ Keyword | `research_keywords` (+ position) | human-curated; the highest-signal edges |
| Paper —IN_COURSE→ Course —IN_SCHOOL→ School | submission catalog via record | |
| Paper —PUBLISHED_IN→ Year | repository year | |
| Paper —SHARES_KEYWORD_WITH→ Paper | derived: shared keyword count | computed, never stored |
| Author —COAUTHORED_WITH→ Author | derived: shared papers | computed, never stored |

Derived edges are computed at read time, never persisted. Storing them would
create a cache-invalidation problem on every decision; recomputation over a
hundred-paper corpus is milliseconds.

Rejected and pending submissions never appear: no node, no edge, no aggregate
contribution. The graph reads repository tables only, never intake — the same
domain-separation rule as search.

## 3. Read API (bounded, visibility-gated at every hop)

Two endpoints, both read-only:

- `GET /api/graph/neighborhood?type=paper|author|keyword|course&id=&depth=`
  Depth capped at 2. Per-type node caps (e.g. 50 papers, 30 keywords) so one
  hub node cannot blow up the response. Returns nodes + edges for React Flow.
- `GET /api/graph/counts?groupBy=keyword|course|year`
  Aggregates for the REO view. Counts are PER-VIEWER: a RESTRICTED paper
  contributes to a manager's counts and to nobody else's. A global count that
  ignores visibility would leak the existence of restricted work through
  arithmetic — this is the subtlest correctness requirement in the design.

Every hop re-applies the shared visibility predicate (`visibility.ts`), the
same module search and download use, so the three surfaces cannot drift apart.
Anonymous callers get the anonymous subgraph; nothing else changes shape.

No write paths. No mutation, no curation UI, no feedback loop in v1.

## 4. UI: one API, two views (discovery first)

- **Discovery view (build first):** paper-centered ego graph. Open from a
  search result ("related papers"), expand one hop at a time, rank neighbors
  by shared-keyword count, shared authorship, then same course. The course
  fallback keeps pre-keyword records connected without pretending they are
  topically similar. Serves every role, including REO reviewers checking
  related work during review. Bounded queries are the simplest to gate
  correctly.
- **REO aggregates view (implemented):** concentration charts + top
  co-occurring keyword pairs, per the counts endpoint. The manager navigation
  exposes this operational view; the read endpoint still applies per-viewer
  policy for every caller so direct public/UA reads cannot leak hidden totals.

Both render with React Flow. No custom canvas code.

## 5. Relationship to keywords and semantic search

- Keywords v1 (`keywords`/`research_keywords`) is the graph's concept layer
  as shipped: shared normalized rows are shared nodes with no further work.
- The deferred controlled vocabulary (post-Stage-8) would upgrade edge
  quality (synonym merging) without any graph-side schema change — the graph
  joins on `normalized_name` either way.
- System-derived topics, when they arrive in their own table, become a
  second, visually distinct edge type (`Paper —SUGGESTS_TOPIC→ Topic`), never
  mixed into `TAGGED_WITH`. Author claim vs. system inference stays legible.
- Semantic vectors stay out of v1. After Stage 8, the honest fusion is
  "semantic candidates filtered by graph neighborhood" (exact, explainable),
  not blended scores — score blending needs the relevance harness first.

## 6. Why citation edges are out (explicit non-goal)

Citation edges require (a) segmenting each PDF's bibliography into individual
references and (b) fuzzy-matching free-text references to repository records.
Student formatting varies; matching needs title/author/year heuristics whose
false positives assert false scholarly links — worse than no links for an
institutional repository. Most references point outside SULUAN (journals,
books), forcing a choice between modeling external works as nodes (scope
explosion, no canonical IDs) or dropping them (a misleadingly empty graph).
The Cloud Run extractor does not segment bibliographies. Revisit only as a
dedicated extraction proposal with its own accuracy gate — never as a
drive-by addition to graph UI work.

## 7. Build gating and verification

- Build starts after the Stage 7 exit gate (authorization, leakage,
  idempotency, recovery checks pass). The graph is a new read surface and
  must not precede the gate it would need re-verification against.
- First testable dataset is the Stage 8 corpus (40 fixtures); the current
  staging fixtures cannot validate co-occurrence behavior.
- Verification (Stage 7 family, to be specified at build time):
  - expansion endpoints return no restricted/pending/rejected nodes or edges
    to unauthorized viewers, including via multi-hop paths;
  - per-viewer counts never leak restricted existence through arithmetic;
  - depth and per-type caps hold against hub nodes;
  - anonymous responses carry the anonymous cache policy only.
- Proof artifact: independent/blinded check that a second viewer role sees
  exactly the authorized subgraph, mirroring the search visibility tests.

## 8. Open questions (answer before build, not before planning)

1. Author identity: `record_authors` are strings, so "J. Dela Cruz" and
   "Juan Dela Cruz" are different nodes. Acceptable for v1 (documented, same
   class as keyword synonyms), or does REO want a lightweight author-alias
   pass first?
2. Should the discovery view link back into filtered search
   (`?keyword=`) bidirectionally, or is graph→search enough for v1?
3. Retention: the graph is computed live, so no retention policy beyond the
   underlying tables — confirm no snapshot/export requirement from REO.

Owner-approved implementation defaults (2026-10-05): author identity remains
literal under the documented trim/lowercase/whitespace normalization; v1 links
graph → search rather than adding search-side graph filters; and no graph
snapshot/export is created. These choices add no inferred identity, retained
derivative, or write path.

Aggregate implementation notes (2026-10-05): each response includes the top 20
groups only and labels any omitted tail. Keyword pairs count distinct visible
papers carrying both human-provided terms; they do not claim semantic
similarity. `totalPapers` includes all visible accepted papers, including those
without the selected metadata, so the UI does not imply complete tagging.
