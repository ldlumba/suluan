# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary public audience is a research reader: a UA student, faculty member,
or public visitor looking for accepted University of the Assumption research.
Authors submit papers and track their own submissions; REO managers review and
operate the repository.

## Product Purpose

SULUAN is the University of the Assumption's research submission, repository,
and discovery application. Its public experience should help readers discover
accepted UA research, understand its metadata and context, and access papers
when the record's visibility policy allows it.

## Positioning

SULUAN connects institutional research submission and REO review with a
visibility-aware public repository, rather than treating discovery as a
separate ungoverned file collection.

## Operating Context

Authors submit PDF/DOCX research. REO managers manually accept or reject each
submission. Accepted papers are extracted automatically, indexed for dependable
keyword discovery, and may later receive separately governed semantic
processing. Public discovery is available signed out where visibility permits.

## Capabilities and Constraints

- Public keyword-first repository search, metadata browsing, graph discovery,
  and visibility-aware downloads are implemented.
- Submission, submitter status, and REO review are authenticated workflows.
- Pending and rejected submissions must never appear in public discovery or AI
  evidence.
- Visibility policies are authoritative on the Worker; the browser is never an
  authorization boundary.
- Semantic search is disabled until its independent relevance and availability
  gate passes.
- The browser must not receive database, storage, Gemini, Gmail, or service
  account secrets.

## Brand Commitments

- Product name: SULUAN.
- Institutional context: University of the Assumption and its Research and
  Extension Office.
- The supplied UA homepage analysis in
  `docs/design/ua-homepage-teardown.md` is a visual reference for navy, red,
  blue, gold, flat surfaces, and confident institutional presentation.
- Geist remains the selected application typeface for this redesign.

## Evidence on Hand

- Existing repository routes, search results, submission and review flows, and
  graph views in `apps/web/src`.
- The supplied UA homepage analysis; no invented corpus counts, testimonials,
  or institutional statistics are available for the home page.

## Product Principles

1. Help readers discover accepted UA research quickly.
2. Make access and publication boundaries understandable without exposing
   protected material.
3. Treat the repository as governed institutional knowledge, not an anonymous
   upload folder.
4. Prefer dependable keyword discovery while experimental semantic capability
   remains gated.

## Accessibility & Inclusion

Public routes must remain usable signed out and support keyboard navigation,
visible focus, readable contrast, responsive layouts, semantic headings, and
screen-reader labels for navigation and controls.
