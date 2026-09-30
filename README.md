# SULUAN

Institutional research submission, repository, discovery, and research-intelligence platform for UA / REO.

- **`AGENTS.md`** — working instructions for AI agents (read first).
- **`SULUAN_ARCHITECTURE_V1_CONTEXT.md`** — locked architecture baseline; changes require owner approval.

## Repository layout

- `apps/web` — React + Vite + TypeScript frontend (exists now).
- `apps/worker` — Cloudflare Worker API (reserved; built at the submission/review stage).
- `services/processing` — Python document ingestion for Cloud Run (reserved; built at the processing stage).

## Commands

```bash
npm install        # install workspace dependencies
npm run dev        # start frontend dev server
npm run check      # lint + typecheck + test (run before considering work done)
npm run build      # production build
npm run format     # apply Prettier
```

Stage-gated plan and architecture rules: see `SULUAN_ARCHITECTURE_V1_CONTEXT.md` (Stages 0–2 are established; later stages are proposed order).
