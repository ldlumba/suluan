# SULUAN documentation index

This index identifies the current operational documents and separates them from
historical evaluation evidence. The architecture context remains authoritative
for approved decisions; a historical deployment record is never authorization
to recreate a retired environment.

## Current production and operations

| Document | Purpose |
|---|---|
| [`production-environment.md`](production-environment.md) | Production topology, access policy, deployment evidence, and operational gates |
| [`cloud-run-processing.md`](cloud-run-processing.md) | Current extraction, embedding, scheduling, and manual-operation boundaries |
| [`error-handling.md`](error-handling.md) | Implemented conflict, recovery, and safe-failure behavior |
| [`gmail-notifications.md`](gmail-notifications.md) | Durable notification design and Gmail integration |
| [`public-discovery.md`](public-discovery.md) | Visibility-aware public search and downloads |
| [`keyword-search.md`](keyword-search.md) | Keyword indexing and retrieval behavior |
| [`semantic-search.md`](semantic-search.md) | Semantic/hybrid policy, validation history, and current constraints |
| [`semantic-query-service.md`](semantic-query-service.md) | Regional semantic-query transport |
| [`research-assistant.md`](research-assistant.md) | Assistant policy, threat model, evidence rules, and limitations |
| [`citations.md`](citations.md) | Citation generation and DOI enrichment |
| [`knowledge-graph-design.md`](knowledge-graph-design.md) | Read-only graph and analytics policy |

## Architecture and product design

| Document | Purpose |
|---|---|
| [`../SULUAN_ARCHITECTURE_V1_CONTEXT.md`](../SULUAN_ARCHITECTURE_V1_CONTEXT.md) | Authoritative architecture baseline and dated amendments |
| [`architecture/suluan-v1-frontend-handoff.md`](architecture/suluan-v1-frontend-handoff.md) | Locked frontend stack and browser/backend boundaries |
| [`../PRODUCT.md`](../PRODUCT.md) | Product audience, purpose, voice, and durable UX constraints |
| [`../apps/web/DESIGN.md`](../apps/web/DESIGN.md) | Implemented frontend design system |

## Historical and bounded evaluation evidence

The following documents are retained for reproducibility and audit history.
They describe staging or bounded pilot work and are not current deployment
instructions.

| Document | Status |
|---|---|
| [`staging-environment.md`](staging-environment.md) | Historical; development and staging resources were retired on 2026-10-21 |
| [`pilot-test-design.md`](pilot-test-design.md) | Historical governed pilot protocol |
| [`stage8-pilot-results.md`](stage8-pilot-results.md) | Historical Stage 8 execution evidence |
| [`semantic-launch-review.md`](semantic-launch-review.md) | Historical semantic review artifact |
| [`semantic-search-adviser-review.md`](semantic-search-adviser-review.md) | Historical adviser-suite review |
| [`pilot-corpus-manifest.csv`](pilot-corpus-manifest.csv) | Content-free pilot fixture identities and expectations |
| [`pilot-result-log.csv`](pilot-result-log.csv) | Pilot result template/evidence |
| [`semantic-launch-review.csv`](semantic-launch-review.csv) | Historical semantic review data |

## Reading rules

- **LOCKED** decisions require explicit owner approval to change.
- **IMPLEMENTATION RULE** states a required safeguard, not proof that it exists.
- **PROPOSED / TBD** remains unresolved unless a later dated amendment explicitly
  supersedes it.
- Verify current code, deployed configuration, and test evidence independently;
  documentation alone is not proof of implementation or ISO conformance.
