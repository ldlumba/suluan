# AGENTS.md — SULUAN

## First read

- `SULUAN_ARCHITECTURE_V1_CONTEXT.md` (repo root) is the authoritative baseline for architecture, workflow, access, and security decisions. Read it before any schema, auth, workflow, or infra work.
- Honor its status vocabulary:
  - **LOCKED** — finalized v1; change only with explicit owner approval.
  - **IMPLEMENTATION RULE** — required safeguard; does *not* imply existing implementation.
  - **PROPOSED / TBD** — never silently promote to locked. Keep TBD items explicit in answers.
- Do not treat that document as proof that accounts, tables, resources, or tests exist.

## SULUAN frontend architecture

Read `docs/architecture/suluan-v1-frontend-handoff.md` before frontend work, alongside the main SULUAN Architecture v1 specification. The handoff locks the approved frontend stack (React Router, Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form, Zod, Lucide, Recharts, React Flow) and browser/backend boundaries; it updates only the frontend — all other Architecture v1 decisions remain in force. Apply its frontend agent rules. Future/TBD items are not authorization to implement.
  - Assistant quotas (messages/day, prompt length, turns, answer size, 3–5 evidence chunks) are **TBD** — the handoff's numbers are illustrative only. The frontend displays API-reported limits via a single labeled placeholder config until that endpoint exists; never present those figures as approved. Server-side enforcement is authoritative.

## Project state (verify before assuming)

- **Stage 0 (local bootstrap) completed 2026-09-30:** npm-workspaces monorepo; `apps/web` is a Vite + React 19 + TypeScript 6 app, plus the frontend-handoff foundation: React Router (`src/app/router.tsx` + `routes.tsx`), Tailwind v4 + shadcn/ui (`src/components/ui/`), and Lucide icons. `apps/worker` (Cloudflare Hono API) and `services/processing` (Python extraction) now exist and are implemented. Feature folders (`src/features/*`) arrive with their features, per the handoff's structure.
- **Stage 1 (Neon DB) done 2026-09-30, metadata updated 2026-10-07:** `packages/db` holds the Drizzle schema (`identity`, `intake`, `repository`, `operations`); migrations through 0012 are applied to the `suluan-dev` Neon project (ap-southeast-1) and verified with `db:check`. Migration 0008 owns the approved 4-school/24-course catalog and repository acceptance year; migration 0009 backfills ordered repository authors; migrations 0010–0011 add author keywords and region-stable embedding claims; migration 0012 permits only one active frozen-suite evaluation claim. First-admin provisioning stays TBD.
- **Stage 2 (auth) done 2026-09-30:** `apps/worker` (Hono) verifies Firebase ID tokens via Google JWKS, enforces the `ua.edu.ph` allowlist, and loads/auto-creates Neon profiles over the HTTP driver. `apps/web` has the Firebase client SDK, auth provider, Google sign-in, and `/signin`. Decisions recorded in the context doc: domain allowlist, dev-only admin promotion. Production admin provisioning, alumni access, and full verification policy stay TBD.
- **Stage 3 (submission/review) done 2026-10-01:** Worker-proxied R2 upload flow (browser POSTs multipart to `POST /api/submissions`; Worker streams bytes into private R2, then atomically writes submission + outbox with idempotency key), REO review queue + remarks-enforced decisions, manager-only streamed downloads, transactional outbox + queue consumer with log email adapter. Web has the submission form (RHF + Zod) and review UI. Upload defaults recorded in the context doc. Keyword search, semantic embedding infrastructure, and Cloud Run extraction are implemented and dev-verified (see below); Gmail production sender stays TBD.
- Local prerequisites verified 2026-09-30, updated 2026-10-03: Node 22 + npm 10, Git, Python 3.13, global `wrangler` (Cloudflare) and `firebase-tools`, `gcloud` installed and authenticated for dev, `services/processing/.venv` created with Python 3.13 and `requirements.txt` installed. Dev billing is attached (`suluan-dev`) with the PHP 250 monthly budget alert set. `psql` remains optional (Neon is remote). No Docker required by the architecture (Cloud Run images build remotely via Cloud Build).
- Earlier Supabase/prototype assumptions are superseded. Never carry over prototype schemas, auth rules, upload behavior, or infrastructure.

## Commands (verified 2026-09-30)

- `npm install` — install workspace dependencies (run after pulling).
- `npm run check` — **lint + typecheck + test. Run before considering any task done.**
- `npm run dev` — frontend dev server (Vite, http://localhost:5173).
- `npm run build` — production build (`tsc -b && vite build`).
- Single test: `npm run test -w web -- <path-or-name-filter>` (Vitest filter; e.g. `-- src/app/routes.test.tsx`).
- Adding shadcn/ui components from the repo root: `npx shadcn add <component> -y -c apps/web` — shadcn detects the monorepo and **requires `-c apps/web`**; without it init/add fails.
- `npm run format` / `npm run format:check` — Prettier. Markdown is deliberately excluded from formatting.
- `lint`/`typecheck`/`test` aggregate across packages via `--workspaces --if-present`; `dev`/`build`/`preview` point at `-w web`, while `dev:worker` and `dev:worker:remote` point at `-w @suluan/worker`.
- Database (`packages/db`, Drizzle + drizzle-kit; decision recorded in the context doc):
  - `npm run db:generate` — regenerate SQL migrations from schema (no DB needed).
  - `npm run db:migrate` — apply migrations. Needs root `.env` with `DATABASE_URL` set to the Neon dev **direct** endpoint — pooled endpoints are unsafe for DDL.
  - `npm run db:check` — assert Stage 1 tables/enums/constraints exist in the dev DB.
  - `npm run db:promote-admin -- <email>` — **dev only**: grants ADMIN to an existing profile by email. Never a production mechanism.
  - `npm run db:seed:dev` — compatibility verification only: confirms migration 0008 supplied the 4-school/24-course catalog; it no longer inserts SAMPLE rows.
  - The db integration test skips automatically when `.env`/`DATABASE_URL` is absent, so `npm run check` stays green on credential-less clones.
- Worker (`apps/worker`, Hono; decisions recorded in the context doc):
  - `npm run dev:worker` — local API on http://localhost:8787. Reads `apps/worker/.dev.vars` (copy from `.dev.vars.example`; git-ignored) — NOT the root `.env`. Use the pooled Neon endpoint + real `FIREBASE_PROJECT_ID` there.
  - Browser CORS is exact-origin allowlisted via `ALLOWED_ORIGINS` (committed default `http://localhost:5173` in `wrangler.toml`; production overrides via dashboard, never `"*"`). Missing ACAO on a preflight means the origin isn't listed — not an auth failure.
  - Token verification uses Google's public JWKS — no service-account secret needed. Tests inject a local JWKS (`createApp` factory) so no Google network dependency.
  - Cloudflare Workers have no TCP Postgres access: the Worker reaches Neon via the HTTP driver (`@neondatabase/serverless`) — never `pg` direct. (Supersedes the earlier forward-looking note.)
  - neon-http has **no interactive transactions** (`db.transaction()` throws). Multi-row atomicity uses single-statement data-modifying CTEs (`apps/worker/src/writes.ts`); unique constraints arbitrate concurrent duplicates. The outbox pattern still holds — the CTE *is* the atomic commit.
  - `wrangler dev` emulates R2 and Queues **locally** (`.wrangler/`, git-ignored) — local R2 supports the Worker's proxied put/get, so uploads and manager downloads work locally with plain `npm run dev:worker`. Use `npm run dev:worker:remote` only when testing against real Cloudflare resources (needs `wrangler login` once + the `suluan-notifications-dev` queue to exist).
  - R2 bindings have **no presigned-URL API**: the browser never talks to R2 directly (no bucket CORS needed). Uploads arrive as multipart bodies the Worker validates and streams into R2 under server-owned `intake/<uuid>/` keys; downloads stream back through the Worker after authorization.
- Web auth: Firebase config lives in `apps/web/.env.local` (`VITE_FIREBASE_*`, git-ignored); missing config disables sign-in UI only. `src/setupTests.ts` registers testing-library cleanup manually — Vitest runs without globals so auto-cleanup never fires (renders leak between tests without it).
- Web UI: Base UI `Select.Value` resolves the trigger label **only** from the `items` data prop — with pure component children it falls back to the raw value. Always pass `items={list.map(x => ({ value: x.id, label: x.name }))}` alongside `SelectItem` children.

## Locked stack (do not add to it casually)

Browser → **Cloudflare Workers** (API/authz) → **Neon PostgreSQL** (authoritative data + FTS + pgvector) and **Cloudflare R2** (private files). **Firebase Auth** for Google sign-in only; permissions live in Neon, enforced by Workers. **Cloudflare Queues → Cloud Run** (Python, PyMuPDF/python-docx) for document processing; **Gemini** for embeddings + limited assistant; **Gmail API** for notifications.

Do not add Supabase, a separate vector/graph DB, Elasticsearch, MongoDB, Redis, RabbitMQ, a warehouse, Kubernetes, a VPS, or a custom auth/email server without a demonstrated requirement and an explicit architecture revision.

## Rules easy to violate

- **Domain separation:** submission data ≠ published repository data in Neon. Acceptance is the only bridge. Uploads are never immediately searchable or eligible as AI evidence.
- **Rejected submissions:** store in the REO-only archive; never index, embed, or expose to public discovery, graphs, analytics, or AI evidence.
- **State separation:** review state (`PENDING`/`ACCEPTED`/`REJECTED`) is distinct from ingestion state (`PROCESSING`/`INDEXED`, exact enums TBD). A processing failure must never undo acceptance.
- **Roles:** `USER`, `REPOSITORY_MANAGER`, `ADMIN`. `STUDENT_RESEARCH`/`FACULTY_RESEARCH` are research categories, not privilege levels. Never trust client-supplied roles, ownership, workflow states, file keys, or hidden UI as authorization.
- **Email is a notification channel:** persist to Neon first, send async. Failed email must never lose a submission or decision. Retry without duplicating acceptance/rejection. Email attachment limits must not decide submission success — fall back to an authenticated review link.
- **R2 stays private:** short-lived, scoped URLs issued only after authorization. No document blobs in Neon; no storage credentials in the browser.
- **Heavy PDF/DOCX parsing runs on Cloud Run**, never in request-bound Workers.
- **Durable handoffs:** use a transactional outbox (or equivalent) from DB changes to queued work; make retried jobs and repeated requests idempotent (no duplicate records, embeddings, or notifications).
- **Secrets:** server-side only, placeholders committed. Gemini/DB/storage/service-account/Gmail OAuth secrets never in the repo or client.
- **AI guardrails:** enforce quotas/rate limits server-side before paid work; treat uploaded and retrieved text as untrusted data; assistant evidence requires ACCEPTED + INDEXED plus visibility permissions.
- **Cost:** free plans during bootstrap, no paid upgrades, embed once per content/model change, budgets/alerts before enabling billable services. Planning figures in the context doc are assumptions, not verified pricing.

## Stage roadmap

Owner-approved continuation route (2026-10-03). Complete each exit gate before
advancing; a later stage does not waive unresolved security, policy, or recovery
work from an earlier one.

- **Stage 0 — Local bootstrap: DONE (2026-09-30).** Monorepo, frontend
  foundation, local configuration placeholders, and quality checks.
- **Stage 1 — Neon database: DONE (2026-09-30).** Domain-separated schema,
  migrations, roles, workflow state, and audit foundations.
- **Stage 2 — Authentication/authorization: DONE (2026-09-30).** Firebase
  Google sign-in, UA-domain validation, Neon permissions, and Worker authz.
- **Stage 3 — Submission/review: DONE (2026-10-01).** Private R2 uploads,
  durable submission/decision writes, REO review, outbox notifications, and
  submitter status UI. Production Gmail delivery remains a later-stage item.
- **Stage 4 — Discovery/processing baseline: DONE IN DEV (2026-10-03).**
  Visibility-aware keyword search, semantic infrastructure, local recovery
  runner, and bounded Cloud Run extraction are implemented. Manual Cloud Run
  execution passed end to end. Semantic production use remains gated on Stage 8.
- **Stage 5 — Pilot test design: DONE (2026-10-04).** The approved design in
  `docs/pilot-test-design.md` fixes a privacy-safe 40-fixture set: 36 authorized
  legacy papers identified by hash plus four generated image-only/malformed/
  encrypted cases. `docs/pilot-corpus-manifest.csv` and the result-log template
  define reproducibility, expected outcomes, and pass thresholds. No paper
  content is committed and execution remains gated on isolated staging.
- **Stage 6 — Isolated staging environment: DONE (2026-10-04).** Separate staging Neon, private R2, Worker/Queue/secrets,
  Firebase, Cloud Run Job/image, and project-scoped budget alert are provisioned.
  Clean migrations, no-op reapply, Neon snapshot-to-temporary-branch restore,
  generated upload/review/extraction/index/search/download, rejected non-
  derivation, and restricted anonymous denial passed without development
  resources. Scheduler, Gemini, and OCR remain disabled. The owner-approved
  staging Worker 5-minute outbox recovery sweep and temporary UA Gmail OAuth
  sender are active as of 2026-10-05; Cloud Run scheduling and an institutional
  production sender stay deferred. A single staging
  administrator is provisioned; owner decision 2026-10-04 is to proceed with no
  second staging account. Two trusted admins remain a Stage 9 item. See `docs/staging-environment.md`.
- **Stage 7 — Reliability/security hardening: DONE (2026-10-05).** Pending/
  rejected non-leakage (including keyword filter/display), PUBLIC/UA_ONLY/
  RESTRICTED + embargo enforcement, denied restricted downloads, idempotent
  submissions/decisions/indexes/keyword bridging, outbox + processing lease
  reclaim with stale-claim rejection, safe malformed/encrypted/oversize/
  image-only handling, interruption recovery via queue backoff + 5-minute
  sweep, notification isolation (failed email never reverses decisions), audit
  context, and stale-token rejection all verified by tests or live evidence.
  `ADMIN`/`REPOSITORY_MANAGER` documented as enforcement-identical
  (`MANAGERS`). Owner-approved policy: consumer `max_retries` 3, then the
  staging DLQ with a REO-mailed always-ack alert; logs carry IDs and routing
  addresses only, never titles/remarks/bodies, on Cloudflare default
  retention; staging Cloud Run scheduling is now bounded at 15 minutes, while
  development and production scheduling remain separately controlled. Gmail
  revocation drill
  deferred to the Stage 9 sender rotation (unit behavior pinned by tests).
  See `docs/staging-environment.md`.
- **Stage 8 — Larger corpus pilot: DONE, SEMANTIC FAILED CLOSED (2026-10-05).**
  Run `20261005T103129Z` passed the governed 40-fixture staging workflow: exact
  36/36 extraction baselines, four exact safe failures, 36 snapshots/1,224
  chunks, 40/40 byte-identical manager downloads, visibility denials, replay
  idempotency, 21/21 rank-1 keyword probes, and 5/5 clean negatives. One
  pre-claim Cloud Run 401 recovered on explicit retry with no loss/duplication.
  P04's accidental PUBLIC choice was recorded and tested, never directly
  rewritten. The frozen 25-query semantic holdout was not scored because
  Cloudflare Worker calls intermittently failed Gemini's location policy; the
  runtime path therefore failed availability before ranking could pass. The
  Gemini secret and temporary request-limit override were removed and semantic
  is verified unconfigured. See `docs/stage8-pilot-results.md`. Any retry needs
  an explicit region-stable architecture revision; keyword remains dependable.
- **Region-stable embedding path implemented 2026-10-06 (paid frozen run pending).**
  `embedding_claims` (migration 0011), `POST /api/internal/embeddings/claim`
  + `/result` on the existing workload identity, and
  `services/processing/embed_runner.py` move paid Gemini calls to a pinned
  `asia-southeast1` Cloud Run Job with quota consumed at claim time. Migrations
  through 0012, the Worker routes, and the isolated evaluator Job are active in
  staging; the evaluator remains preflight-only with no Gemini secret. Corpus
  completion, temporary key attachment, and the paid frozen evaluation remain;
  interactive semantic search stays disabled meanwhile.
- **Isolated batched semantic evaluation activated in staging 2026-10-07 (paid run pending).** Frozen suites of up to 20 queries reserve one request plus N inputs and use one pinned-region Gemini `batchEmbedContents` call. The Worker verifies eligible corpus completeness and current embedding geometry, computes a deterministic corpus snapshot, rejects overlapping claims, and stores one sanitized artifact in private R2. `--preflight` verifies identity, corpus, query hash/count, and quota headroom without a Gemini key, claim, or paid call. Evaluation uses the separate manual `suluan-semantic-eval-staging` Job with no Scheduler binding; never repoint `suluan-processing-staging`. Migration 0012 is applied in development and staging; Worker version `246a3cbd-7560-4684-b31e-a74923073fdb` is deployed; and evaluator image digest `sha256:bf4fcc89fe91c101e5c2fe6df6726cd36a20cacb32f7d7d9827a81da79e0b741` is pinned with no secret. Preflight execution `suluan-semantic-eval-staging-jp9zs` authenticated and verified the frozen 16-query hash, 39 eligible records/1,227 chunks, zero missing embeddings, zero unindexed records, and corpus snapshot `603a92476dff09f45cfdd081fb5949e3e2753ce4646eefc11900097a1eb21bcc`; it then failed closed only because the invalid earlier run had exhausted the 20-request daily quota. Usage remained 20 requests/20 inputs and no evaluation claim was created. A paid run remains prohibited until quota reset and the completed legacy corpus replaces this interim snapshot. Semantic remains disabled.
- **Chunker v1 retained after audit 2026-10-07.** A content-free staging aggregate found 1,188 non-final chunks, only 24 ending at sentence punctuation and 23 at a newline; 80/1,227 chunks mentioned references. Despite the expected fixed-window boundaries, `chars-2000-overlap-200-v1` remains frozen for the governed pilot because its 200-character overlap preserves boundary context and it produced 20/20 development Hit@1. Do not silently change chunking before the frozen run. Section-aware boundaries/title-heading prefixes/reference exclusion require a separately versioned comparison only if completed-corpus failures justify it.
- **Knowledge Graph discovery v1 implemented 2026-10-05.** The public `/graph`
  view opens from search results and renders a bounded paper-centered metadata
  neighborhood with React Flow. `GET /api/graph/neighborhood` is read-only,
  depth-capped at 2, and starts every hop from the shared effective-visibility
  predicate; unauthorized centers return 404 and cannot leak through related
  nodes or counts. Author aliases, exports/snapshots, citation edges, semantic
  fusion remain out of scope. The second v1 slice is also implemented:
  `/api/graph/counts` and `/graph/analytics` provide capped per-viewer
  keyword/course/year concentrations and keyword-pair co-occurrences, with no
  stored aggregates or graph writes. See `docs/knowledge-graph-design.md`.
- **Stage 9 — Production/institutional readiness.** Resolve institutional cloud
  and billing ownership, two trusted admins, production first-admin process,
  identity/domain policy, real catalogs, retention/withdrawal/replacement/
  deletion and backup/restore policies, Gmail/REO authorization, privacy/data
  processing approval, observability/incident ownership, and semantic approval.
  **Exit:** resources, credentials, policies, and operations are institutionally
  owned and production-ready, not dependent on one developer account.
- **Stage 10 — Controlled production pilot.** Launch to a small authorized
  cohort with conservative limits, active cost/failure review, documented
  rollback, keyword search as the dependable path, and semantic disabled unless
  Stage 8 passed. **Exit:** complete the agreed observation period without a
  critical security, workflow, data-loss, or cost issue before wider rollout.

## Maintaining this file

- **Submission metadata/catalog revision (2026-10-04):** migration 0008 installs the approved institutional catalog (4 schools / 24 courses), remaps the prior `[SAMPLE]` selections, removes those sample rows, and adds `research_records.year integer NOT NULL`. The submission form no longer asks for year or research type; repository year is the database UTC calendar year at acceptance and existing records were backfilled from `decisions.decided_at` (falling back to record creation time). Legacy nullable `submissions.year` / `research_type` columns remain for migration safety but new writes ignore them. Search returns the repository year. The submit page keeps the canonical school/course selects and adds a compact responsive side catalog; clicking a course fills both fields. Bulk import and admin decision-history remain deferred.
- **Public discovery + visibility (2026-10-01):** migration 0006 adds `research_records.visibility` (`PUBLIC`/`UA_ONLY`/`RESTRICTED`, default PUBLIC) and `embargo_until`. ALL read paths must filter through `apps/worker/src/visibility.ts` (`effectiveVisibility` row predicate + `effectiveVisibilityLevel` label) so search and download cannot drift apart. Two SQL traps are already fixed once — keep the regression tests: (1) embargo fragments MUST be parenthesized (`not a is not null and ...` binds as `not (a is not null)`, and a NULL date then excludes every row); (2) the anonymous predicate must match the EFFECTIVE level, not the raw column, or auto-lift never becomes public. `GET /api/search/records` is public (anonymous results get `public, max-age=30`; authenticated get `private, no-store`) — `optionalAuth` degrades a missing/invalid token to anonymous but still 403s a valid non-UA token. `POST /api/search/index` stays manager-only (writes snapshots). `GET /api/records/:id/download` streams public accepted papers (same 404 for every viewer so IDs can't be probed). `GET /api/submissions/mine` is the submitter status view: own submissions + remarks only, and it grants NO download access.
- **Embargo semantics:** an embargo date is stored only for UA_ONLY/RESTRICTED; on PUBLIC it is a **no-op** (normalized to NULL, not an error). Past dates are rejected. A future embargo on PUBLIC degrades the effective level to UA_ONLY; an elapsed embargo lifts UA_ONLY/RESTRICTED to PUBLIC.
- **Semantic embeddings (2026-10-01):** migration 0007 adds `semantic_indexes` (one row per keyword snapshot × model × width), `document_embeddings` (`vector(768)`, **UNIQUE(chunk_id)` is the embed-once guarantee at the storage layer**), and `embedding_usage` (daily request/input counters). Model is **`gemini-embedding-001`, NOT `text-embedding-004`** — the latter was deprecated 2026-01-14 and is removed from the API; the rationale and the rejected `gemini-embedding-2` comparison are in §12. `GEMINI_API_KEY` goes in `apps/worker/.dev.vars` (git-ignored, server-side only, never in `wrangler.toml`); it is currently an `AQ.` auth key, so `apps/worker/src/embeddings.ts` calls the REST endpoint with `fetch` instead of a Google SDK whose format check rejects `AQ` keys. Vectors are **L2-normalized before storage** — `gemini-embedding-001` does not auto-normalize non-3072 dims, so skipping it silently breaks cosine ranking. The dev quota is **20 requests AND 2,000 inputs per UTC day**; the temporary 40-request relevance-evaluation window was completed and reverted on 2026-10-02. Quota is consumed BEFORE the paid call and every denial degrades to keyword results (`semanticStatus: quota_exhausted`), never an error. Anonymous per-IP counters are deliberately **not** implemented (personal data + no privacy notice yet). Semantic preparation maps one manager action to **one synchronous Gemini request of at most 20 chunks / two papers**, paced at least 30 seconds apart by the operator; never burst multiple provider calls inside one Worker request, automatically retry a 429, or refund quota after a provider failure. No HNSW/IVFFlat index yet — exact scan at corpus scale.
- **Semantic traps — keep the tests:** (1) `toVectorLiteral` must return a BARE literal with no `::vector` suffix; interpolated into a parameterized query it arrives as a bound string and Postgres parses the trailing cast as junk ("Junk after closing right brace"), so call sites use `cast(? as vector)`. (2) Semantic search embeds with `RETRIEVAL_QUERY` and keyword/indexing uses `RETRIEVAL_DOCUMENT`; the same text yields different vectors, which is what makes asymmetric retrieval work — do not unify them. (3) Preparation candidates are missing **chunks** (`NOT EXISTS document_embeddings`), not missing semantic snapshots. A snapshot can legitimately be partial after interruption; filtering on `NOT EXISTS semantic_indexes` makes it unrecoverable. (4) Snapshot resolution must return the id on both insert and conflict. `ON CONFLICT DO NOTHING RETURNING id` returns zero rows on chunks 2..N, so a downstream vector CTE silently embeds only chunk 0. The set-based insert uses a no-op `DO UPDATE ... RETURNING id`, then inserts every batch vector via `jsonb_to_recordset`. Regression fixtures MUST contain multiple chunks and assert `vectors == chunks`; a one-chunk fixture cannot detect this class of failure. (5) Nearest-neighbour search always has a closest result, even when it is irrelevant. `MAX_SEMANTIC_DISTANCE = 0.7` remains only a defensive bound. The 2026-10-02 curated evaluation ranked all 20 positive targets first, but all five clean negatives still returned results under `0.7`; positive target distances were `0.1754`–`0.2733` and negative top distances `0.3881`–`0.4260`. Do not fit a production cutoff to that same small, topic-informed set. The record score is `MIN` over chunks, and one 61-chunk paper topped four of five unrelated queries, so length bias remains plausible. Keep final relevance settings TBD until an independent/blinded holdout with realistic user phrasing validates abstention and false positives; do not expose semantic mode in production before that gate is passed.
- **Keyword-first discovery (2026-10-01, metadata/sorting updated 2026-10-04, scheduled indexing 2026-10-06):** migration 0005 enables pgvector and creates `keyword_indexes` snapshots plus `document_chunks` with generated `simple` tsvectors and a GIN index. Worker `/api/search/records?q=&page=&sort=` returns 10 records/page for accepted records, gated by the visibility policy above; allowed sorts are relevance, title, newest, oldest, and course, with stable record-id tie-breaking. Results include ordered repository authors plus canonical school/course names joined through the accepted submission; school/course are metadata-searchable. `fullTextStatus` is `READY` (extracted + indexed), `PENDING`, or `FAILED`. Blank browse mode is metadata-only; a non-empty query returns a whitespace-normalized, word-boundary-trimmed snippet only for `READY` records. A deployed Worker scheduled sweep indexes up to 50 accepted `EXTRACTED` records missing the current snapshot; `POST /api/search/index` remains a manager-only, idempotent incident/recovery escape hatch accepting `{}` or `{recordId}` and atomically storing chunks + snapshot + audit. Queued extraction jobs are untouched by indexing alone. `KEYWORD_READY` describes a snapshot, not an extraction enum or semantic INDEXED status. Embeddings use `gemini-embedding-001` (768 dims, see semantic bullet); Cloud Run extraction is dev-verified (see Cloud Run bullet). See `docs/keyword-search.md`.

- **Local extraction slice (2026-10-01, Cloud Run verified 2026-10-03):** `services/processing` contains the Python PyMuPDF/python-docx core and operator CLI; see its README. Migration 0004 adds `processing_jobs` with `QUEUED/PROCESSING/EXTRACTED/FAILED`, created atomically on acceptance and backfilled for existing accepted records. Worker `/api/processing/jobs` plus `/:id/claim`, `/:id/result`, `/:id/retry` require managers. Lease-fenced results prevent stale completions; failed jobs require explicit retry. `EXTRACTED` records are indexed automatically by the deployed Worker's five-minute scheduled sweep (bounded at 50 records); `POST /api/search/index` remains a manager-only incident/recovery escape hatch. OCR remains deferred. Cloud Run is the verified dev extraction path (see Cloud Run bullet); the local runner remains for operator-driven recovery.
- **Cloud Run processing (2026-10-03, staging scheduler enabled 2026-10-06):** code is deployed to dev and smoke-tested. `services/processing/cloud_runner.py` is a bounded Cloud Run Job entry point; it pulls Neon-backed claims through `/api/internal/processing/*`, downloads private R2 bytes through the Worker, runs the existing bounded parser, and posts a lease-fenced result. Workload auth is separate from Firebase: Google metadata-server ID tokens are pinned to exact `PROCESSING_SERVICE_AUDIENCE` + `PROCESSING_SERVICE_ACCOUNT`; no manager profile, shared secret, service-account JSON key, direct Neon, or direct R2 access. System audit rows have null actor plus service-account context. Dev activation verified 2026-10-03: Job `suluan-processing` (`asia-southeast1`), execution `suluan-processing-lssfx`, fixture reached `Full text searchable`; PHP 250 budget alert is set. Staging Job `suluan-processing-staging` is automatically started every 15 minutes by a dedicated least-privilege Cloud Scheduler identity; the database lease and five-job bound protect retries and overlap. Development remains manual. The runner sends a browser-compatible `User-Agent` because the `workers.dev` edge rejects bare Python clients with Cloudflare 1010 before the Worker runs. See `docs/cloud-run-processing.md`. Production scheduling and region changes remain deferred.
- **Legacy corpus processing completed 2026-10-08.** After 139 individual manager acceptances, 30 sequential manual executions of the unchanged five-claim `suluan-processing-staging` Job (safe alongside the 15-minute scheduler through database leases) produced 139/139 `EXTRACTED`, zero failures. The scheduled keyword sweep indexed all 139 records into 4,107 chunks. Combined staging retrieval corpus: 178 records/5,334 chunks (the 39 prior extractable pilot records plus 139 legacy records; four accepted pilot safe-failure fixtures remain non-extractable).
- Processing tests: `services/processing/.venv/Scripts/python.exe -m unittest discover -s services/processing -v` from repo root, **in addition to** `npm run check`. Venv uses Python 3.13 with `services/processing/requirements.txt` installed. `gcloud` and dev cloud billing/budget alert are set up; production billing/scheduling remain deferred.
- **Legacy importer (2026-10-04; staging import 2026-10-08):** `services/importer/importer.py` is the owner-approved local "hand me the folder" path for the authorized 100+ paper corpus. Each opted-in PDF/DOCX has same-stem Markdown with strict YAML front matter (`title`; optional `authors`, `school`, `course`). No manifest means an intentional skip by default; `[NO TITLE]` in a filename always skips; `--strict` turns other unmanifested documents into audit errors. It fetches the live catalog with the acting manager's Firebase token, validates the entire folder before upload, defaults to dry-run, rejects opted-in `.doc`, uses deterministic environment-scoped idempotency keys, uploads sequentially through `POST /api/submissions`, checkpoints a redacted JSON report with ready/skipped/error reasons, and leaves every row `PENDING`. It never writes Neon/R2 directly, accepts papers, parses documents, indexes, embeds, or imports Markdown body notes. Token comes from hidden prompt or process-scoped `SULUAN_ID_TOKEN`, never CLI/manifest/report. Setup/tests: `python -m venv services/importer/.venv`; install `services/importer/requirements.txt`; run `services/importer/.venv/Scripts/python.exe -m unittest discover -s services/importer -v`. See `services/importer/README.md`. The same importer may be run once per environment by the authorized operator; API origin is part of idempotency. The final compressed corpus has 139 ready papers and 18 intentional skips (11 no manifest, 7 `[NO TITLE]`), zero errors/warnings, no Pajarillo or Word lock file, and matches the governed development set by logical path and metadata (68 documents intentionally converted to PDF). On 2026-10-08 the staging dry-run passed, apply created 139 unique `PENDING` submissions/files, and immediate apply replay returned the same 139 IDs with zero new rows. Immediate post-import reconciliation found zero decisions and zero repository records, confirming non-leakage before the later authorized review recorded below. Redacted reports are outside the repo under `C:\Users\Lims\AppData\Local\Temp\opencode\staging-legacy-import-{dry-run,apply,replay}-20261008.json`. Admin decision history and bulk acceptance remain deferred.
- **Staging legacy review completed 2026-10-08.** The manager individually accepted all 139 imported papers through the existing review workflow. No bulk-acceptance mechanism was introduced. Acceptance created 139 repository records and processing jobs; subsequent extraction/indexing is recorded above. Admin decision-history UI remains deferred.
- **Full-corpus embedding progress 2026-10-08.** `suluan-embed-staging` is manual and scheduler-free, pinned to evaluator image digest `sha256:bf4fcc89fe91c101e5c2fe6df6726cd36a20cacb32f7d7d9827a81da79e0b741`, and tightened to one claim per execution with zero retries. Obsolete query-file environment variables were removed so the Job is document-only. The first 20 executions were paced at least 30 seconds apart and consumed 20 requests/395 inputs. The owner then approved a temporary staging-only request ceiling of 110/day while retaining 2,000 inputs/day; Gemini Embedding 1 provider limits were verified as 100 RPM/30K TPM/1,000 RPD, and Worker `679e15f5-efa1-4085-9927-2505d1709cde` deployed the override. Another 81 paid claims completed once; an 82nd execution received no claim/quota increment and stopped the loop at the input boundary. Day-end evidence: 101 requests/1,992 inputs, 101/101 claims used, zero active claims, zero geometry mismatches, and 3,219/5,334 chunks embedded (2,115 missing). Keep one claim/execution, ≥30-second pacing, and zero retries. Revert both staging overrides after 100% document coverage plus the one isolated frozen evaluation, or by 2026-10-15, whichever comes first. Production defaults remain 20 requests/2,000 inputs; interactive semantic search stays disabled.
- **Final-day semantic capacity staged 2026-10-08.** Exact accounting found the remaining 2,115 chunks across 62 papers need at least 133 paper-bounded document claims; the frozen suite adds one request/16 inputs. The owner approved superseding the temporary staging limit with 145 requests/2,200 inputs so both can fit after one UTC reset with margin. Worker `ef9619d3-abd7-4e88-8f11-21c25458284e` deployed the limits; quota-free preflight `suluan-semantic-eval-staging-w5mt9` confirmed them plus the unchanged frozen hash, 178 records/5,334 chunks, zero unindexed records, and 2,115 missing chunks. Its expected `ready: false` spent no quota. Do not spend the evaluation reservation before document coverage is verified at 100%. Revert the overrides and detach the evaluator secret immediately after the complete frozen run, or by 2026-10-15. A passing evaluation—not quota availability—remains the semantic launch gate.
- **Completed-corpus semantic evaluation 2026-10-09 (scorer audit 2026-10-10).** Document coverage reached 5,334/5,334 chunks. Preflight passed on the final snapshot; one isolated 16-query batch completed as run `d3f267f2-983f-4496-954d-703018e584b4`, artifact SHA-256 `70c460ec37f04e08e1b390e6046a96e4bea3c0723c868b06b029a11f745072cf`. Title-label normalization corrected the preregistered MIN/0.38 results to 6/7 direct positives and 3/4 hard positives at rank 1, with 75% clean-negative abstention; the policy still failed. A diagnostic length-penalized strategy reached 4/4 hard positives and 100% negative abstention at a 0.36 floor, but one direct positive remained rank 2. The evaluator secret was detached, limits reverted to 20/2,000, and semantic/Assistant remain disabled. A new approved policy and validation remain required.
- **Independent holdout 2026-10-10.** The registered 25-query holdout (`118734b708ab02b526bc858017bdc12180f2f4877f8ed2a7f30262ff1887c90b`, zero adviser overlap) ran in two bounded batches on the completed corpus. MIN/top-3 achieved 15/15 positive, 5/5 hard-positive, and 5/5 clean-negative abstention; keyword Hit@1 was 15% and record-level RRF 100%. This is diagnostic support for hybrid retrieval, not launch approval; the adviser gate remains failed and semantic/Assistant remain disabled. The evaluator secret was detached and the Job restored to preflight-only.
- **Development corpus cleanup (2026-10-04):** the seven accepted non-`[CORPUS]` development records and their private R2 objects were owner-approved for removal before legacy import. The development repository now retains only the 15 `[CORPUS]` relevance fixtures (including their processing/search/semantic data). Cleanup target IDs and R2 keys are recorded outside the repo at `C:\Users\Lims\AppData\Local\Temp\opencode\suluan-dev-cleanup-2026-10-04.json`.

- Outbox recovery (2026-10-01): migration 0003 adds claim tokens and expiring leases. Notification completion is recorded after dispatch; failures have a one-minute cooldown, abandoned claims expire after five minutes. A five-minute scheduled sweep enqueues up to 50 due rows, including failed initial enqueues. The cron runs automatically only on a deployed Worker; local/manual invocation uses Wrangler's scheduled-event testing. Real external email delivery remains at-least-once across a send/DB failure; the log adapter is not proof of Gmail delivery.
- **Staging Gmail activation (2026-10-05):** the temporary
  `ld_lumba.student@ua.edu.ph` OAuth sender is active through the Gmail API;
  `REO_MAILBOX` currently points to the same pilot mailbox. A generated fixture
  completed normal upload and individual acceptance, and the mailbox received
  both the REO submission notice and the submitter decision notice with exact
  remarks. The queue reported `sent`, which occurs only after Gmail returns a
  message ID and the `SENT`/`gmail` notification row is persisted. OAuth uses
  `openid email` only for consent-account verification plus Gmail's send-only
  scope. A second-account staging check then proved recipient separation and
  the rejection path: the REO notice reached the configured review mailbox,
  while the rejection notice reached only the different UA submitter and
  included exact remarks; anonymous search returned no result for the rejected
  title. This is staging evidence, not institutional sender approval; rotation
  to an REO mailbox remains Stage 9.
- **REO email attachments (2026-10-05):** new-submission mail resolves canonical
  authors/school/course/file metadata from Neon at dispatch time and attaches
  the private R2 PDF/DOCX only when Gmail is active and the source file is at
  most 15 MiB. The queue consumer is the only reader; R2 stays private and no
  key enters the outbox or email. The 15 MiB source ceiling lands near 20.5 MB
  MIME, leaving real margin under Gmail's ~25 MB decoded-message cap (an 18 MiB
  proposal was rejected on this math at ~25.8 MB MIME). Larger files send metadata
  with an explicit SULUAN-review fallback and never fail submission. A hosted,
  authenticated review link remains later work; rejected-file retention stays
  deferred. Staging Worker `6aac2080-f02e-4919-9f98-3962b7238dbb` live-verified
  the complete metadata body and a Gmail-recognized/downloadable generated PDF
  attachment; the fixture was then rejected to avoid repository derivatives.
  A follow-up fix (`8c741ab`, Worker `2891cc9b`) replaced per-byte base64 with
  chunked conversion after a 9.9 MB paper exceeded the queue consumer CPU
  limit; both 9.9 MB mails then delivered as single copies with scanned
  attachments.

- **Author keywords v1 (2026-10-05):** optional chip input on the Submit page
  (free text, up to 5, one `keywords[]` part per chip — Hono drops repeated
  bare keys). Stored verbatim in `submission_keywords`, bridged on acceptance
  into shared `keywords` concept rows + `research_keywords` links (migration
  0010; `db:check` covers the tables). Shown in the review queue, decision
  dialog, REO mail, status view, and search results; search adds an exact-match
  `keyword` filter with no ranking effect. No controlled vocabulary, no synonym
  merging, no backfill, no semantic integration — all deferred past Stage 8.
  System-derived topics will live in a separate table, never in keywords.
  Staging live-verified on Worker `d280a872`: chip submit → intake rows →
  REO mail Keywords line + attachment → queue/dialog display → accept →
  shared concept rows → search display, filter narrowing, empty-state, and
  clear. The filter is a controlled input with explicit Apply, not a nested
  form (nested submission bypassed React and issued a bare `?kw=` GET).

- Add verified commands and non-obvious conventions here as the codebase gains them; delete anything stale.
- Record approved changes to the architecture baseline with rationale and date in `SULUAN_ARCHITECTURE_V1_CONTEXT.md`.
