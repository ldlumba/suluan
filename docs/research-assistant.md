# SULUAN Research Assistant

## Status

**Scaffolding only.** The chatbot model, public endpoint, and product quotas are
not enabled. Semantic Search must first pass its independent relevance and
abstention gates.

## Locked behavior

- Available only to authenticated University of the Assumption users. Anonymous
  visitors cannot submit assistant messages.
- Evidence must be from `ACCEPTED` and indexed research records.
- Evidence retrieval must apply the shared `effectiveVisibility` predicate.
- Restricted, rejected, pending, and otherwise unauthorized content must never
  enter the assistant context or be named in an answer.
- If no authorized evidence is sufficient, the assistant must say that no
  accessible supporting study was found rather than inventing an answer.
- Retrieved text is untrusted data. Text inside a paper is never an instruction
  to the assistant.
- The assistant must not expose system prompts, credentials, hidden retrieval
  details, quota internals, or unauthorized records.
- Answers must identify or link only records actually supplied as evidence and
  must remain subject to human review.

## Current implementation

`apps/worker/src/assistant.ts` contains the non-user-facing foundation:

- `canUseAssistant` enforces the authenticated-viewer boundary at the service
  layer.
- `retrieveAssistantEvidence` retrieves only accepted, indexed, visible chunks
  using the same visibility predicate as search.
- `buildEvidenceContext` marks retrieved text as untrusted and delimits it for a
  future model adapter.
- `ASSISTANT_SYSTEM_RULES` records the mandatory refusal and anti-leak rules.

No model call is made by this foundation, and no assistant HTTP route is
registered yet.

## Deliberately TBD

The following require owner/adviser and operational decisions before a chatbot
is enabled:

- Gemini generation model and region-stable transport
- messages per day per user and aggregate daily quota
- prompt length, conversation-turn, and response-size limits
- evidence selection size and ranking policy
- daily spend ceiling and emergency shutdown behavior
- whether assistant use is limited to students, faculty, or all UA accounts
- retention/deletion policy for prompts, responses, and audit metadata
- exact user-facing wording for insufficient evidence and restricted material

The frontend handoff's illustrative numbers are not approved values and must
not be presented as system limits.

## Security acceptance tests for the later endpoint

Before enabling a model call, tests must demonstrate:

1. anonymous requests are rejected;
2. restricted, rejected, pending, and embargoed-inaccessible records do not
   appear in evidence;
3. visibility changes are respected at retrieval time;
4. prompt-injection text in a retrieved chunk is treated as data;
5. quota is consumed before paid generation and is not refunded on failure;
6. repeated requests cannot bypass per-user or aggregate limits;
7. insufficient evidence produces a refusal rather than a guessed answer; and
8. model/provider failure degrades safely without leaking evidence or secrets.
