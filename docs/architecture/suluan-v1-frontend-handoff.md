# SULUAN Architecture v1 — Frontend Framework Handoff

**Status:** Locked frontend decisions; additive handoff for the existing Architecture v1 context  
**Date:** 2026-09-30  
**Audience:** OpenCode, Codex-style coding agents, and SULUAN developers  
**Source:** “SULUAN Architecture Costs” conversation and the explicit frontend handoff request

## 1. Scope and precedence

This document updates **only the frontend portion of SULUAN Architecture v1**. It formalizes the React ecosystem used to build the application. It does not replace Architecture v1, create Architecture v2, or authorize changes to the backend, data model, infrastructure, access policies, REO workflow, AI limits, integrations, or cost-control principles.

Read this alongside the main Architecture v1 context and the repository's `AGENTS.md`. For frontend stack choices, this handoff supersedes earlier incomplete frontend descriptions. For all other domains, the existing Architecture v1 specification remains authoritative. An omission here does not remove an existing requirement. If documents conflict outside this frontend update, surface the conflict instead of silently redesigning the system.

The stack and architectural boundaries below are locked. The folder structure is recommended implementation guidance. Items explicitly marked future/TBD are not implementation commitments.

## 2. Locked frontend stack

| Technology | Assigned responsibility |
| --- | --- |
| **React + TypeScript** | Typed UI components, presentation, interaction, and local UI state. |
| **Vite** | Frontend development tooling and production static build. |
| **React Router** | Client-side routes, navigation, nested layouts, and route-level user experience. |
| **Tailwind CSS** | Styling, responsive layouts, and consistent design tokens. |
| **shadcn/ui** | Shared UI component foundation, adapted consistently within the project. |
| **TanStack Query** | API/server-state queries, caching, request status, mutations, invalidation, and controlled refetching. |
| **React Hook Form** | Form state, field interaction, submission handling, and validation integration. |
| **Zod** | Frontend schemas and validation for forms and relevant API boundaries. |
| **Lucide React** | Consistent application icons. |
| **Recharts** | Presentation of descriptive analytics supplied by the backend. |
| **React Flow / `@xyflow/react`** | Interactive Knowledge Graph visualization and navigation. React Flow is the library; `@xyflow/react` is its React package, not an additional framework. |

SULUAN needs this ecosystem for public discovery, authenticated submissions, REO review, role-specific dashboards, search, the Research Assistant, Knowledge Graph exploration, and analytics. These capabilities remain one React application with a separate backend boundary.

Exact dependency versions are not selected by this handoff. Use compatible versions, the repository's package manager, and its lockfile. Do not use this document as justification for unrelated upgrades.

## 3. Locked service responsibilities — Architecture v1 preserved

| Layer/service | Authoritative responsibility |
| --- | --- |
| **React/Vite frontend** | Presentation, forms, client routing, UI state, and API consumption. It displays backend decisions and results. |
| **Cloudflare static hosting** | Serve the built frontend assets. The frontend remains a statically deployed client application. |
| **Cloudflare Workers** | Backend/API and business-logic boundary: verify identity, enforce authorization, validate requests, manage workflow transitions, enforce quotas, and control access to data and documents. |
| **Neon PostgreSQL + pgvector** | Authoritative application data, role/permission records, workflow state, metadata, provenance, relationships, full-text search, and vector data. |
| **Firebase Authentication** | Identity through Google Sign-In. Identity does not itself grant SULUAN permissions. |
| **Cloudflare R2** | PDF/DOCX document storage with access controlled by backend policy. |
| **Cloudflare Queues** | Existing background-job orchestration, including workflow email and processing jobs. |
| **Google Cloud Run** | Server-side document processing and ingestion pipeline. |
| **Gemini** | Embeddings and the limited, evidence-grounded Research Assistant using retrieval-augmented generation (RAG). |
| **Google Workspace / Gmail API** | Existing submission/review notification and decision-email integration. |
| **Crossref, OpenAlex, OpenCitations** | Existing scholarly metadata and citation integrations. |

The normal application data path is:

```text
React frontend -- HTTPS API --> Cloudflare Workers --> Neon / approved services
       |
       +-- Firebase client SDK --> Google Sign-In / identity token
```

The browser supplies its Firebase identity token to protected API requests. Workers verify it and enforce permissions using authoritative backend data. Route guards, hidden buttons, and client-side role checks improve the interface; they cannot authorize an operation.

Document upload/download access is obtained through Workers. A direct browser-to-R2 transfer is permitted only through a backend-authorized, scoped transfer mechanism such as a short-lived signed URL. Never expose storage credentials. Cloud Run jobs, queue operations, Gemini calls, and privileged email/integration actions remain server-side.

React Flow does not become a graph database; relationships remain in Neon. Recharts does not become the authoritative analytics engine; it visualizes permitted backend aggregates. TanStack Query's cache does not become a second database.

## 4. Existing product and security rules remain in force

These are preservation reminders, not new backend requirements:

> **Repository note (2026-09-30):** The assistant quota figures in this section (10 successful messages/user/day, 500-character prompts, last 4 conversation turns, ~400-token answers, 3–5 evidence chunks) are **illustrative conversation figures, not client-approved policy**. The authoritative position is that exact quotas remain TBD per Architecture v1 §7 (and the 3–5 chunk selection is a starting point, not a fixed quota, per §5). The frontend mirrors API-reported limits via a single labeled placeholder config until the quota endpoint exists; see `AGENTS.md`. Enforcement is server-side regardless.

- Keep the existing public visitor, authenticated UA user, repository manager, and administrator access model. Display only API-authorized data and capabilities.
- Preserve UA-authenticated student/faculty submission of metadata and PDF/DOCX documents, REO email notification, review inside SULUAN or through the established email workflow, required remarks for Accept/Reject, and decision email to the submitter.
- Keep submissions, decisions, published research, documents, chunks/embeddings, and provenance/audit data as distinct domain concepts. Acceptance is the governed bridge into the repository.
- Preserve REO-only rejected records. Pending and rejected material must not appear in public discovery or semantic/AI retrieval. Semantic processing starts only after acceptance; AI evidence requires accepted and indexed research.
- Preserve the Research Assistant limits: **10 successful messages per user per day**, **500-character prompts**, **last 4 conversation turns**, approximately **400-token answers**, and **3–5 evidence chunks**. Semantic search remains separate from the chatbot quota. Workers/Neon enforce these rules; the frontend only mirrors limits and displays authoritative usage/errors.
- Keep secrets server-side. Frontend environment configuration is publicly recoverable from a built application; it must not contain database credentials, service-account keys, storage secrets, Gemini credentials, or Gmail authorization secrets. Firebase public client configuration is not an authorization mechanism.
- Preserve existing storage-growth assumptions, archive/import scope, school/course decisions, document-version policy, retention TBDs, and development roadmap. This handoff changes none of them.
- Preserve cost controls: avoid unnecessary polling, defer embeddings until acceptance, avoid duplicate document storage where possible, and use backend caching/precomputed analytics as already planned.

## 5. Frontend state and data ownership

| State category | Default owner |
| --- | --- |
| Remote records, search results, review queues, analytics, graph data | TanStack Query, backed by Workers APIs. |
| Forms and field validation state | React Hook Form with Zod schemas. |
| Component interaction, open dialogs, selection, display preferences | React `useState` / `useReducer`; small context providers only when sharing is needed. |
| Identity/session presentation | Small authentication provider using Firebase Authentication. |
| Shareable search/filter/page state | Router URL parameters where appropriate; parse and validate inputs. |
| Business records, roles, workflow decisions, quotas | Workers and Neon; never an independently authoritative browser store. |

Use stable, parameterized query keys and invalidate affected queries after successful mutations. Scope protected caches to the current user/access context and clear protected cached data on logout or account changes. Handle permission changes and API denials even when a page was previously accessible.

Keep fetching conventions centralized. Do not scatter ad hoc `useEffect` + `fetch` implementations across pages for ordinary server state. Choose deliberate retry/refetch behavior; do not automatically replay submissions, review decisions, uploads, or billable AI actions without a safe API contract.

## 6. Recommended feature-oriented source structure

This tree describes the frontend source root, whether the repository places it at `src/` or inside a frontend workspace. Adapt to established repository conventions without moving backend code into the frontend.

```text
src/
├── app/
│   ├── router/             # Routes and navigation/access presentation
│   ├── providers/          # Auth, QueryClient, and other small providers
│   └── layouts/            # Public, authenticated, and management shells
├── features/
│   ├── auth/
│   ├── repository/
│   ├── submissions/
│   ├── reo-review/
│   ├── search/
│   ├── assistant/
│   ├── knowledge-graph/
│   ├── analytics/
│   ├── citations/
│   └── administration/
├── components/
│   ├── ui/                 # Shared shadcn/ui-based primitives
│   └── shared/             # Reusable cross-feature presentation
├── lib/
│   ├── api/                # HTTP client, auth attachment, error handling
│   ├── validation/         # Truly shared validation helpers
│   └── utilities/          # Small, domain-neutral utilities
├── types/                  # Truly shared frontend/API types
├── styles/                 # Tailwind entry and shared theme styles
└── main.tsx
```

Create subfolders only when needed. A feature can grow into:

```text
features/reo-review/
├── api/                    # Typed calls to Workers endpoints
├── components/             # Review-specific UI
├── hooks/                  # Query/mutation and interaction hooks
├── pages/                  # Route-level screens
├── schemas/                # Review forms, including required remarks
└── types/                  # Feature-local types
```

Keep domain-specific code beside its feature. Shared UI must not own workflow policy. Feature `api/` folders contain browser API clients, not backend endpoints. Shared schemas/types may describe contracts, but privileged validation and policy enforcement still run on the server.

## 7. Frontend rules for OpenCode/Codex-style agents

Apply these rules when creating or updating the project's `AGENTS.md`:

1. **Read the baseline first.** Consult Architecture v1, this handoff, existing agent instructions, API contracts, and repository conventions before editing. Limit this update to frontend work.
2. **Use the locked stack.** Prefer the approved React ecosystem and native browser capabilities. Reuse existing components, schemas, hooks, and API helpers before adding dependencies or abstractions.
3. **Keep backend behavior in Workers.** Never move authorization, role assignment, workflow transitions, quota accounting, SQL, privileged storage access, processing orchestration, or provider secrets into the browser.
4. **Treat client validation as user assistance.** Validate forms with React Hook Form + Zod and display field-level errors. Backend validation remains mandatory. Client file-type/size checks are not security enforcement.
5. **Keep routes within the client application.** Use React Router for navigation and layouts. Protected routes must tolerate expired identity, forbidden access, and missing resources. Static hosting must support direct navigation to intended client routes without masking API errors.
6. **Use typed API contracts.** Centralize token attachment and common error handling. Handle loading, empty, error, permission-denied, and success states. Do not invent endpoints or silently present mocked data as integrated functionality; label temporary mocks and document missing contracts.
7. **Respect workflow truth.** Show pending/accepted/rejected and processing/indexing states from the API. Require remarks in review forms and submit decisions through Workers. Do not optimistically claim acceptance, publication, or indexing before authoritative confirmation.
8. **Keep AI and documents behind their service boundaries.** Display upload/processing progress and assistant evidence returned by APIs. Do not parse documents for the ingestion pipeline, generate embeddings, or call Gemini directly in the browser.
9. **Use one coherent UI foundation.** Build with Tailwind, shadcn/ui, and Lucide React. Preserve keyboard navigation, labels, focus behavior, readable errors, responsive layouts, and accessible chart/graph alternatives where needed.
10. **Keep data use bounded.** Use pagination/filtering and deliberate cache settings. Avoid fetching entire collections merely to filter locally. Load expensive graph/chart screens when needed and avoid repeated requests that undermine existing cost controls.
11. **Validate the affected behavior.** Run relevant existing type, lint, and build checks. Verify forms, navigation, error handling, and changed query/mutation behavior. Add focused tests for meaningful risks, especially access-state handling and review actions; frontend tests do not prove backend authorization.
12. **Report scope accurately.** State what changed, what was verified, and any unresolved API/product dependency. Do not present unimplemented backend work or TBD decisions as completed features.

## 8. Locked exclusions and the exception rule

Do **not** introduce any of the following under the current baseline:

- Next.js or a second application framework.
- Redux or another additional global state-management framework.
- SSR, server components, server actions, frontend-owned API routes, or other full-stack frontend behavior.
- Duplicate routing, form, validation, styling, component, or data-fetching frameworks without demonstrated need.

An exception requires a **documented requirement** that the approved stack cannot reasonably satisfy. Record the gap, options considered, proposed change, deployment/cost/security implications, and explicit effects on Architecture v1 before implementation. A dependency preference or agent convenience is not a requirement. Changes to locked architecture must be explicitly adopted by the project owner; this handoff alone does not authorize them.

## 9. Future/TBD considerations — not locked decisions

| Consideration | Current position / decision needed |
| --- | --- |
| Public SEO and individual research-page discovery | Determine actual indexing, metadata, sharing-preview, and discoverability requirements. Do not assume a framework migration is necessary. |
| Public-page prerendering/static generation | Possible future approach for approved public metadata pages. Publication/access rules, refresh/invalidation behavior, tooling, and hosting details remain TBD. Never prerender restricted content. |
| SSR or a full-stack framework | Not part of v1's frontend baseline. Reconsider only through the documented exception process. |
| Detailed UI design and visualization behavior | Branding, exact dashboard layouts, graph layout algorithms, and advanced interaction details require feature requirements; the chosen libraries do not settle these. |
| Additional dependencies and exact versions | Select only as needed during implementation, with compatibility review and an updated lockfile. No speculative framework additions. |

Public SEO/prerendering work must preserve Workers as the backend/business-logic boundary, Neon as authoritative data, and the existing access model unless a separate architecture change is explicitly adopted.

## 10. Using this handoff in the repository

Recommended location: `docs/architecture/suluan-v1-frontend-handoff.md`.

Reference it from the root `AGENTS.md` alongside the main Architecture v1 document. Keep non-frontend Architecture v1 instructions intact. A suitable reference is:

```markdown
## SULUAN frontend architecture

Read `docs/architecture/suluan-v1-frontend-handoff.md` before frontend work,
alongside the main SULUAN Architecture v1 specification.
The handoff locks the approved frontend stack and browser/backend boundaries.
It updates only the frontend; all other Architecture v1 decisions remain in force.
Apply its frontend agent rules. Future/TBD items are not authorization to implement.
```

This deliverable is project context for an agent setup. It does not itself modify a repository's `AGENTS.md`, install dependencies, or provision services.
