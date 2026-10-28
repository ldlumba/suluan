# SULUAN

SULUAN is the University of the Assumption Research and Extension Office's
research submission, review, repository, and discovery system. It combines a
public, visibility-aware research repository with controlled submission and
review workflows, keyword and semantic discovery, citation support, a bounded
research assistant, and audited repository administration.

- **Public application:** <https://suluan-repository.pages.dev>
- **Production API health:**
  <https://suluan-api-production.ctrlfinder.workers.dev/api/health>
- **Current documentation index:** [`docs/README.md`](docs/README.md)
- **Architecture authority:**
  [`SULUAN_ARCHITECTURE_V1_CONTEXT.md`](SULUAN_ARCHITECTURE_V1_CONTEXT.md)

## Architecture

```text
React browser application
        │
        ▼
Cloudflare Worker API ─────► Neon PostgreSQL
        │                         │
        ├──────────────► private Cloudflare R2
        │
        └──────────────► Cloudflare Queues / Google Cloud Run
                                      │
                                      └──► Gemini APIs (bounded features)
```

- `apps/web` — React 19, React Router, TypeScript, Tailwind CSS, shadcn/ui,
  TanStack Query, React Hook Form, and Zod.
- `apps/worker` — Hono API on Cloudflare Workers. It verifies Firebase identity,
  enforces Neon-backed roles and visibility, and mediates every database and
  private-file operation.
- `packages/db` — Drizzle schema, migrations, database checks, and guarded
  administrative scripts.
- `services/processing` — bounded Python document extraction, semantic-query,
  embedding, assistant, and operations-dispatcher workloads for Cloud Run.
- `services/importer` — local, dry-run-first importer for authorized legacy
  papers; every imported submission remains pending for individual review.

The authoritative domains remain separated: a submission is not a published
repository record until REO acceptance, and rejected submissions are never
searchable or eligible as AI evidence.

## Access model

Application roles are `USER`, `REPOSITORY_MANAGER`, and `ADMIN`. Roles are read
from Neon and never trusted from browser input. Public, university-only, and
restricted records use the same server-side effective-visibility policy across
search, record details, downloads, graphs, analytics, and assistant evidence.

Production normally admits verified `ua.edu.ph` Google identities. Temporary
evaluation access is configured as an exact-email, expiring Worker secret; it
does not add an external domain to the institutional allowlist. New accounts are
created as `USER` and role changes remain administrator-only and audited.

## Local prerequisites

- Node.js 22 and npm 10
- Python 3.13 for processing/importer tests
- Wrangler CLI for local Worker development
- Firebase browser configuration for interactive sign-in
- A Neon database only when running database integration checks

Copy placeholders rather than committing credentials:

```text
.env.example                       → .env
apps/web/.env.example              → apps/web/.env.local
apps/worker/.dev.vars.example      → apps/worker/.dev.vars
```

Secrets belong only in ignored local files or provider secret stores. The
Firebase browser values are public configuration; database, storage, Gemini,
Gmail, and workload credentials are server-side only.

## Install and run

```bash
npm ci
npm run dev
```

The web application runs at `http://localhost:5173`. In another terminal:

```bash
npm run dev:worker
```

The local Worker runs at `http://localhost:8787`. See `AGENTS.md` for verified
environment-specific commands and safeguards.

## Quality checks

```bash
npm run check
npm run build
npm run format:check
```

`npm run check` runs JavaScript/TypeScript linting, strict type checking, and
Vitest suites across the npm workspaces. Database-dependent tests skip when no
`DATABASE_URL` is supplied; this is not evidence that a target database passed
integration checks.

Python suites are currently run explicitly:

```bash
python -m unittest discover -s services/processing -v
python -m unittest discover -s services/importer -v
```

Install each service's pinned requirements in an isolated virtual environment
before running its suite. Production database verification uses
`npm run db:check` with the target's direct Neon endpoint and must never be run
against an unintended environment.

## Documentation and evidence

Start with [`docs/README.md`](docs/README.md). It distinguishes current
production documentation from historical staging and pilot evidence. Historical
documents demonstrate earlier decisions and tests; they do not prove that
retired resources still exist or that their former settings remain approved.

## Known limitations

- OCR for image-only papers is not implemented; these documents fail safely.
- Repository retention, withdrawal, replacement, and permanent-deletion policy
  still require institutional approval.
- Infrastructure and billing remain owner-operated pending institutional
  handover.
- Semantic search and assistant output are bounded aids, not authoritative
  research judgments; their interfaces disclose provenance and limitations.
