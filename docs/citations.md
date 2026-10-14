# Citation support v1

Paper-page "Cite now" section builds APA, BibTeX, and RIS citations only
from SULUAN record metadata: ordered repository authors, repository year
(which serves as the publication year per the 2026-10-11 owner policy), and
title.

## Template

- APA: `Surname, I. I., & Surname2, I. (2026). Title. SULUAN Research
  Repository, University of the Assumption.` Missing year renders `(n.d.)`;
  missing authors render the title first. Unparseable names are used verbatim,
  never guessed.
- BibTeX: `@misc` with `author`, `title`, `howpublished`, and `year`.
- RIS: `TY - UNPB` with per-author `AU`, `TI`, `PY`, and `PB` lines.

The API (`GET /api/records/:id`) exposes an ordered `authorList` array
alongside the existing display string, falling back to newline-split
submission authors when no repository authors exist.

## Limitations

- Records that were never published externally keep the repository citation;
  most student papers will never match, which is the correct outcome.
- Manager-entered publication metadata remains deferred; enrichment is
  automatic-only with no review queue.
- Copy uses the clipboard API with a textarea fallback; BibTeX/RIS download
  as `citation.bib` / `citation.ris`.
- Staging Worker `ce1b855a-7de8-4b9c-8ffa-c9dec8d5526c` serves `authorList`;
  live-verified on an AgriKlima record with three ordered authors.

## Automated DOI enrichment (2026-10-11)

Migration 0014 adds nullable `doi`, `venue`, `volume`, `issue`, `pages`,
`pub_year`, `doi_source`, and `doi_checked_at` to `research_records`. The
Worker's five-minute scheduled sweep checks up to five never-checked accepted
records per run against Crossref (`apps/worker/src/doi.ts`):

- Candidate titles must normalize identically (case, punctuation, and
  spacing collapse away).
- At least one author surname token (length 3+) must overlap, so multi-word
  surnames match across stored and registry forms.
- Registry year must agree within one year.
- Matches store metadata with source `crossref`; misses store only the check
  timestamp so the sweep always progresses; lookup failures stay unchecked
  for a later run.

When verified metadata exists, "Cite now" leads with the published citation
(APA journal form, BibTeX `@article`, RIS `TY - JOUR` with a `DO` line) and
keeps the repository citation below it. The DOI renders as plain text, never
an active link, consistent with inert rendering. Guesses are never stored or
shown; a wrong attachment would need an explicit correction path, which is
deferred until a bad match actually appears.
