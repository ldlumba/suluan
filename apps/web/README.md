# SULUAN web application

This workspace contains SULUAN's React browser application. It provides public
repository discovery and record pages plus authenticated submission, status,
review, administration, repository operations, semantic search, and research
assistant interfaces.

## Commands

Run from the repository root:

```bash
npm run dev
npm run test -w web
npm run typecheck -w web
npm run lint -w web
npm run build
```

The local application defaults to `http://localhost:5173` and calls
`http://localhost:8787` unless `VITE_API_BASE_URL` is configured.

## Browser configuration

Copy `.env.example` to `.env.local` and supply the public Firebase browser
configuration. Missing Firebase configuration disables interactive sign-in but
does not expose server credentials. Production examples are placeholders in
`.env.production.example`; real local values remain ignored.

## Structure

- `src/app` — routing, public pages, and shared layout.
- `src/features` — feature-owned pages, components, and tests.
- `src/components/ui` — shared shadcn/ui primitives.
- `src/lib` — API, Firebase, and TanStack Query infrastructure.

The browser never decides authorization. Roles, workflow state, visibility,
file keys, quotas, and publication eligibility are enforced by the Worker.
Extracted or generated text is rendered as text, never trusted HTML.

Frontend decisions and accessibility expectations are documented in
[`DESIGN.md`](DESIGN.md) and
[`../../docs/architecture/suluan-v1-frontend-handoff.md`](../../docs/architecture/suluan-v1-frontend-handoff.md).
