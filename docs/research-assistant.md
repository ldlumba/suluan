# SULUAN Research Assistant

## Status

**Scaffolding only.** The chatbot model, public endpoint, and product quotas are
not enabled. Semantic Search must first pass its independent relevance and
abstention gates.

## Locked behavior

- Available only to authenticated University of the Assumption users. Anonymous
  visitors cannot submit assistant messages.
- Evidence must be from `ACCEPTED` and indexed research records.
- Evidence retrieval must apply the shared `effectiveVisibility` predicate with
  an intentionally PUBLIC-only evidence scope. A logged-in user may use the
  assistant, but UA_ONLY and RESTRICTED papers are not sent to the free-tier
  provider.
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

## Approved initial model and limits — 2026-10-06

- **Generation model:** `gemini-3-flash-preview` (Google Gemini 3 Flash). The
  exact availability and current model status must be checked in the project
  console before deployment because this is a preview model.
- **Access:** authenticated UA users only; managers are also authenticated UA
  viewers for this policy.
- **Evidence:** PUBLIC records only, even for authenticated users. This is the
  approved free-tier privacy tradeoff: the assistant cannot expose UA_ONLY or
  RESTRICTED paper content to a provider whose free-tier terms may allow use of
  submitted content to improve products.
- **Per-user daily messages:** 10 per UTC day.
- **Aggregate daily messages:** 300 authenticated messages per UTC day.
- **Maximum user prompt:** 1,000 characters.
- **Maximum turns per conversation:** 5.
- **Maximum generated answer:** 800 tokens.
- **Evidence chunks supplied:** 5.

These are enforced server-side before any generation call. A provider failure
does not refund quota. The frontend must display API-reported values rather
than duplicating these limits.

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

- exact model availability/status in the target Gemini project and region-stable
  transport
- evidence ranking policy and final production approval
- daily spend ceiling and emergency shutdown behavior
- whether assistant use is limited to students, faculty, or all UA accounts
- retention/deletion policy for prompts, responses, and audit metadata
- exact user-facing wording for insufficient evidence and restricted material

The frontend handoff's illustrative numbers remain superseded by the approved
values above and must not be presented as system limits.

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
