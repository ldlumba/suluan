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

- **Stage 0 (local bootstrap) completed 2026-09-30:** npm-workspaces monorepo; `apps/web` is a Vite + React 19 + TypeScript 6 app, plus the frontend-handoff foundation: React Router (`src/app/router.tsx` + `routes.tsx`), Tailwind v4 + shadcn/ui (`src/components/ui/`), and Lucide icons. `apps/worker` (Cloudflare) and `services/processing` (Python) are reserved paths that don't exist yet — create them at their stages rather than stubbing them early. Feature folders (`src/features/*`) arrive with their features, per the handoff's structure.
- No CI yet. No cloud accounts/resources provisioned; nothing deployed. Cloud work waits for Stage 1+ credentials.
- Local prerequisites verified 2026-09-30: Node 22 + npm 10, Git, Python 3.13, global `wrangler` (Cloudflare) and `firebase-tools`. Not installed yet and deferred to their stages: `gcloud` (Cloud Run), a Python venv/`uv` (ingestion), `psql` (optional; Neon is remote). No Docker required by the architecture.
- Earlier Supabase/prototype assumptions are superseded. Never carry over prototype schemas, auth rules, upload behavior, or infrastructure.

## Commands (verified 2026-09-30)

- `npm install` — install workspace dependencies (run after pulling).
- `npm run check` — **lint + typecheck + test. Run before considering any task done.**
- `npm run dev` — frontend dev server (Vite, http://localhost:5173).
- `npm run build` — production build (`tsc -b && vite build`).
- Single test: `npm run test -w web -- <path-or-name-filter>` (Vitest filter; e.g. `-- src/app/routes.test.tsx`).
- Adding shadcn/ui components from the repo root: `npx shadcn add <component> -y -c apps/web` — shadcn detects the monorepo and **requires `-c apps/web`**; without it init/add fails.
- `npm run format` / `npm run format:check` — Prettier. Markdown is deliberately excluded from formatting.
- `lint`/`typecheck`/`test` aggregate across packages via `--workspaces --if-present`; `dev`/`build` point at `-w web` and must be updated when `apps/worker` exists.

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

Stages 0–2 are established: **0 local bootstrap — done 2026-09-30** (React/Vite scaffold, repo layout, `.env.example` placeholders, lint/typecheck/test/format setup) → 1 Neon DB (migrations, domain separation, roles, audit; needs dev DB credentials) → 2 Firebase auth + Worker authorization. Later stages are proposed dependency order only. Complete and verify each stage's checks (denied role escalation, cross-user/restricted-file access, pending/rejected leakage, duplicate deliveries, email/ingestion failure recovery) before expanding scope.

## Maintaining this file

- Add verified commands and non-obvious conventions here as the codebase gains them; delete anything stale.
- Record approved changes to the architecture baseline with rationale and date in `SULUAN_ARCHITECTURE_V1_CONTEXT.md`.
