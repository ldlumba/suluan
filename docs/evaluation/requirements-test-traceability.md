# Requirements-to-test traceability

This table links the main product and security requirements to their
implementation, tests, and remaining checks.

| ID | Requirement | Implementation boundary | Primary automated evidence | Residual verification |
|---|---|---|---|---|
| FR-01 | A verified admitted user can submit one PDF/DOCX with valid institutional metadata. | `apps/worker/src/app.ts`, `uploads.ts`, submission web feature | `worker/test/submissions.test.ts`, `uploads.test.ts`; `web/.../NewSubmissionPage.test.tsx`, `schema.test.ts` | Live multipart upload with generated, non-sensitive fixture. |
| FR-02 | Submission retries must not create duplicate rows or objects. | `apps/worker/src/writes.ts`, idempotency key handling | `worker/test/submissions.test.ts` | Authorized database concurrency run. |
| FR-03 | Managers can accept/reject pending submissions with remarks; one decision wins. | Review routes and atomic decision write | `worker/test/review.test.ts`; `web/.../ReviewQueuePage.test.tsx` | Two-session concurrency test on isolated data. |
| FR-04 | Only accepted repository records can enter public discovery and AI evidence. | Domain-separated schema, search/index and assistant evidence predicates | `worker/test/search.test.ts`, `assistant-evidence.test.ts`, `visibility-policy.test.ts` | Inspect a rejected generated fixture across every read path. |
| FR-05 | PUBLIC, UA_ONLY, RESTRICTED, and embargo rules apply consistently to search, details, download, graph, and AI. | `apps/worker/src/visibility.ts` and route predicates | `worker/test/visibility.test.ts`, `visibility-policy.test.ts`, `graph.test.ts`, `assistant-evidence.test.ts` | Role-by-resource runtime matrix. |
| FR-06 | Keyword discovery supports bounded query, filter, sorting, pagination, and safe snippets. | Worker search module and web search feature | `worker/test/search.test.ts`, `keywords.test.ts`; `web/.../SearchPage.test.tsx` | Relevance review with evaluator queries. |
| FR-07 | Semantic discovery must respect eligibility, regional transport, quotas, confidence bands, and keyword fallback. | Semantic, ranking, query-ticket, quota modules | `worker/test/semantic*.test.ts`, `ranking.test.ts`, `query-transport.test.ts`, `quota.test.ts`; processing semantic tests | Live authenticated canary only within approved quota; record provenance labels. |
| FR-08 | The assistant must distinguish grounded, related, general, and clarification modes and cite only selected PUBLIC evidence. | Assistant routes/service and message UI | `worker/test/assistant*.test.ts`; `processing/test_assistant_service.py`; `web/.../AssistantPage.test.tsx` | Evaluator-owned safe prompts, including no-match and injection cases. |
| FR-09 | Accepted files are extracted outside request-bound Workers; failures do not undo acceptance. | Processing jobs, Cloud Run extraction, lease fencing | `processing/test_extraction.py`; Worker processing tests within relevant suites | Controlled malformed/encrypted/image-only fixtures. |
| FR-10 | Notifications are persisted before asynchronous delivery; mail failure cannot lose a submission/decision. | Outbox writes, queue consumer, Gmail adapter | `worker/test/queue.test.ts`, `email.test.ts`, `notifications` coverage | Provider failure/recovery drill with non-sensitive recipients. |
| FR-11 | Citation output preserves ordered authors and clearly handles unavailable publication metadata. | Citation formatting and DOI enrichment | `web/.../formatCitation.test.ts`, `CiteSection.test.tsx`; `worker/test/doi.test.ts` | Compare sample APA/BibTeX/RIS with evaluator rubric. |
| FR-12 | Graph and analytics reads must remain bounded and visibility-aware. | Graph routes and React Flow pages | `worker/test/graph.test.ts`; `web/.../GraphPage.test.tsx`, `GraphAnalyticsPage.test.tsx` | Runtime node/count bounds and restricted-center probes. |
| SEC-01 | Browser-supplied roles, workflow state, visibility, ownership, and file keys are never trusted for authorization. | Auth middleware, Neon profile roles, server-owned writes/keys | `worker/test/auth.test.ts`, `review.test.ts`, `visibility-policy.test.ts`, `submissions.test.ts`; `web/.../ProtectedRoute.test.tsx` | Authorized API tampering/IDOR review. |
| SEC-02 | Authentication admits verified institutional identities plus only active exact-email evaluation exceptions. | `apps/worker/src/config.ts`, auth middleware | `worker/test/auth.test.ts` | Verify assigned account before expiry; verify an unlisted external account is denied. |
| SEC-03 | R2 remains private and all upload/download access is mediated by the Worker. | R2 bindings and authorized streaming routes | `worker/test/submissions.test.ts`, `visibility-policy.test.ts` | Provider-console configuration inspection. |
| SEC-04 | Paid AI work is quota-limited before provider calls and does not retry automatically. | Quota/claim modules and regional services | `worker/test/quota.test.ts`, `embed_claims.test.ts`, `assistant-routes.test.ts`; processing embed/query tests | Inspect production limits and sanitized usage counters. |
| SEC-05 | Administrator changes are audited, optimistic, and cannot remove the final administrator. | `apps/worker/src/admin-routes.ts`, database constraints | `worker/test/admin-users.test.ts`, `admin-catalog.test.ts`; corresponding web admin tests | Controlled stale-edit and last-admin runtime probes. |
| REL-01 | Interrupted work can be reclaimed without stale completions overwriting newer work. | Processing/outbox/embedding claims and leases | `worker/test/queue.test.ts`, `embed_claims.test.ts`, `embeddings.test.ts`; processing runner tests | Authorized interruption and recovery drill. |
| REL-02 | Duplicate-title safeguards warn without exposing another submitter or silently merging records. | Title normalization, intake guard, manager-only duplicate context | `worker/test/titles.test.ts`, `submissions.test.ts`, `review.test.ts` | Generated same/other-user duplicate scenarios. |
| MAINT-01 | Source changes pass formatting, lint, strict type checking, tests, and production build. | Root npm scripts, workspace configs | `npm run format:check`, `npm run check`, `npm run build` | Repeat from clean clone and record environment/duration. |
| PORT-01 | Configuration and secrets remain environment-specific and absent from product source. | Example files, ignored local secrets, provider secret stores | Configuration tests and repository scan evidence | Full-history secret scan and provider-secret inventory. |

## Untraced or incompletely measured quality requirements

The following need evaluator or owner-defined acceptance criteria before they
can receive a defensible pass/fail rating:

- supported browser/OS/device versions;
- WCAG level and assistive-technology matrix;
- p50/p95 latency, throughput, concurrency, and bundle budgets;
- uptime, recovery-time, and recovery-point objectives;
- code coverage and complexity thresholds;
- institutional privacy, retention, withdrawal, and deletion policy;
- production incident response and long-term operational ownership.
