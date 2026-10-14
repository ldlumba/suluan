# Error handling and recovery

## Implemented priority safeguards

### Duplicate submission titles

Submission titles retain their entered display form and also store a normalized
comparison key. The comparison folds case, punctuation, compatibility-width
characters, and repeated whitespace. It is a duplicate-warning mechanism, not
a claim that two papers are identical.

- The same submitter cannot create two `PENDING` submissions with the same
  normalized title. The Worker checks before R2 upload and migration 0015 adds a
  partial unique index to arbitrate concurrent requests.
- A title matching another pending or accepted submission returns a generic
  warning before upload. The submitter may explicitly confirm that it is a
  different paper. Other pending submissions are never named; only
  already-public repository matches (at most 3: title, year, record link) are
  listed, and the submitter's own pending duplicate links to My submissions.
  No other submitter identity or review state is disclosed.
- Rejected submissions are excluded from the guard, so a corrected paper can be
  resubmitted after REO feedback. The rejected attempt and its decision remain
  intact as separate audit history.
- The REO queue labels possible exact normalized-title duplicates and names up
  to 5 matching submissions (title, status, submitter, date) on the
  manager-only endpoint. Managers compare the papers; SULUAN does not
  automatically reject, merge, or delete.
- Idempotency remains separate: replaying the same submission attempt returns
  the original row and never stores a second R2 object.

File-hash and fuzzy-title similarity remain future enhancements. They must also
warn rather than silently determine authorship or equivalence.

### Course availability

Courses are never deleted to remove them from intake. An ADMIN may hide or
restore a course through **Submissions → Course availability**.

- Hidden courses are omitted from the authenticated submission catalog.
- The Worker rejects a crafted submission containing an inactive course.
- Existing submissions and accepted repository records retain and display the
  course because its row and identifier remain intact.
- Updates write an audit event and require the `updated_at` value loaded by the
  admin page. A concurrent change returns `stale_course_edit` instead of silently
  overwriting another administrator.

## Existing safeguards verified during this slice

- Concurrent review decisions are arbitrated atomically; only one decision can
  commit.
- Upload retries use idempotency keys, with best-effort cleanup for a losing R2
  race.
- Processing results are lease- and claim-fenced; stale completions cannot
  overwrite newer attempts.
- Acceptance remains separate from processing failure.
- Search, download, graph, and Assistant evidence apply server-side visibility
  predicates on every request.

## Still deferred

- Withdraw/archive/restore for accepted records requires retention, citation,
  derivative-cleanup, and permanent-purge policy. No timed deletion is approved.
- Post-acceptance title/keyword editing requires audited optimistic concurrency,
  index refresh, citation refresh, and DOI re-verification.
- A formal returned-for-revision/version lineage remains a separate workflow.
