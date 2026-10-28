# ISO/IEC 25010 evidence matrix

## Scope and interpretation

This matrix supports an external review against an unknown edition-specific
rubric. It conservatively covers the ISO/IEC 25010:2011 product-quality model
and the revised 2023 model. It is an evidence index, not a declaration of
conformance or certification.

Status vocabulary:

- **Automated** — repeatable tests or build checks exist in this repository.
- **Operational** — dated, environment-specific evidence is documented.
- **Design** — an implemented control is documented, but independent
  measurement is incomplete.
- **Gap** — evidence required for a defensible rating has not been produced.
- **TBD** — the institutional requirement or acceptance threshold is unresolved.

The 2023 model uses **interaction capability** where the 2011 model used
**usability**, adds **safety**, and introduces **flexibility** while revising the
former portability coverage. Evaluators should apply their supplied edition and
rubric rather than treating the crosswalk as normative wording.

## Evidence matrix

| 2011 characteristic | 2023 characteristic | Current evidence | Status | Remaining measurement or risk |
|---|---|---|---|---|
| Functional suitability | Functional suitability | Submission validation and idempotency; remarks-enforced review; visibility-aware discovery/download; citation, graph, operations, and assistant tests. See [`requirements-test-traceability.md`](requirements-test-traceability.md). | Automated + Operational | Execute evaluator-owned end-to-end scenarios against the identified live deployment. Database suites are not fully reproducible without an authorized target. |
| Performance efficiency | Performance efficiency | Bounded pagination, upload limits, queue batches, processing claims, quotas, and one-claim embedding operations are implemented. Production build reports asset sizes. | Design | **Gap:** no controlled latency percentile, concurrency, throughput, resource-utilization, Lighthouse, or load-test report. Never load-test production without approval. The large main bundle is a known risk. |
| Compatibility | Compatibility | Exact-origin CORS tests; HTTP/JSON boundaries; standard PDF/DOCX intake; responsive React UI. | Automated + Design | **Gap:** no recorded browser/OS/device compatibility matrix or assistive-technology interoperability run. |
| Usability | Interaction capability | Feature-level UI tests cover routing, authentication guards, forms, status, review, search, graph, administration, operations, citations, and assistant disclosures. Labels, keyboard-focus styles, semantic headings, text rendering, and error states are implemented. | Automated + Design | **Gap:** no independent task-completion study, SUS score, WCAG audit, axe report, keyboard-only protocol, screen-reader report, or contrast evidence. |
| Reliability | Reliability | Atomic submission/decision writes, idempotency, outbox recovery, lease fencing, stale-claim rejection, queue retry/DLQ behavior, safe parsing failures, and recovery tests. See [`../error-handling.md`](../error-handling.md). | Automated + Operational | **Gap:** no measured availability, MTBF, MTTR, fault-injection campaign, production RTO/RPO acceptance, or current institutional restore drill. |
| Security | Security | Firebase token verification; exact identity admission; Neon roles; server-side visibility; private R2 mediation; CORS; size/schema validation; quotas; audit events; last-admin guard; untrusted-text handling; authorization regression tests. | Automated + Design | **Gap:** dependency vulnerability audit is unresolved because the package tree first needs a clean-install verification; no independent penetration test, SAST report, SBOM, DAST, or full Git-history secret scan is recorded. Privacy/retention approval remains TBD. |
| Maintainability | Maintainability | Lint, formatting, strict frontend TypeScript, workspace tests, Drizzle migrations, architecture records, feature organization, and bounded extraction of three large modules. | Automated + Design | No coverage threshold, complexity budget, mutation testing, or maintainability-index baseline. `apps/worker/src/app.ts` remains a large coordination module. |
| Portability | Flexibility | Vite browser build, Cloudflare Worker bindings, migration-owned schema, environment templates, remote Cloud Build, and provider boundaries are documented. Credential-free checks run locally. | Automated + Design | Deployment depends on Cloudflare, Neon, Firebase/Google Cloud, and provider configuration. No alternate-provider portability test or clean-clone timing record yet. |
| — | Safety | AI responses label repository evidence versus general guidance; evidence is PUBLIC-only; quotas, no-tool policy, prompt-injection defenses, safe parser failures, and human review boundaries are tested/documented. | Automated + Design | Institutional harm analysis, misuse review, safety acceptance criteria, monitoring thresholds, and incident ownership remain incomplete. Assistant output is advisory and must not be treated as authoritative research judgment. |

## Cross-cutting measurable evidence

| Evidence | Command or document | Latest result | Interpretation |
|---|---|---|---|
| Static quality gate | `npm run check` | Passed 2026-10-28 | Lint, strict type checking, and credential-free JS/TS tests passed. Skips are disclosed in the evaluation README. |
| Formatting | `npm run format:check` | Passed 2026-10-28 | Maintained non-Markdown source matches repository formatting rules. Generated/frozen hash artifacts are explicitly excluded. |
| Production build | `npm run build` | Passed 2026-10-28 | Buildability passed; bundle-size warning remains. |
| Python behavior | `python -m unittest discover ...` | 77 passed 2026-10-28 | Covers extraction, semantic scoring/query, embedding, assistant, dispatcher, and importer behavior. |
| Pilot reliability | [`../stage8-pilot-results.md`](../stage8-pilot-results.md) | Historical bounded staging run | Useful historical evidence only; retired staging is not proof of current production behavior. |
| Production topology | [`../production-environment.md`](../production-environment.md) | Current operational record | Must be reconciled with actual provider configuration and deployment identifiers during evaluation. |
| Architecture safeguards | [`../../SULUAN_ARCHITECTURE_V1_CONTEXT.md`](../../SULUAN_ARCHITECTURE_V1_CONTEXT.md) | Authoritative decision record | A requirement source, not proof of implementation. Verify against code/tests/runtime. |

## Evidence that must not be overstated

1. Passing unit/component tests do not prove production availability or
   end-to-end correctness.
2. A documented control is not equivalent to independent security,
   accessibility, performance, or privacy certification.
3. Historical development/staging results do not prove current production
   configuration; those environments were retired.
4. Skipped database tests do not count as successful integration tests.
5. Semantic and generative relevance tests demonstrate bounded test-set
   behavior, not universal correctness.

## Recommended evaluator measurements

1. Record five representative task flows: public discovery/download, user
   submission/status, manager review, administrator role/catalog control, and
   assistant provenance disclosure.
2. Run WCAG 2.2 AA automated checks plus keyboard-only and screen-reader review
   on public, sign-in, search, record, submission, review, and assistant pages.
3. Record Lighthouse and browser performance traces on a controlled connection;
   include p50/p95 navigation and API timings rather than a single score.
4. Exercise approved compatibility targets in current Chromium, Firefox, and
   Safari/WebKit at desktop and mobile viewport sizes.
5. Run dependency, secret-history, SAST, and authorized DAST scans; triage every
   result rather than reporting raw scanner counts as defects.
6. Use a non-production isolated database for integration and concurrency tests
   only if the owner explicitly authorizes a new test environment. Otherwise,
   document the evidence limitation and avoid destructive production testing.
