# Replacement semantic launch review

Status: owner-approved replacement review process; labels and launch policy pending.

The owner approved a pinned-region interactive Cloud Run service and volunteered
to review the replacement evaluation on 2026-10-10. This does not declare a
passing gate. Keep the original adviser queries and their artifacts unchanged.

## Reviewer task (before seeing rankings)

Use `docs/semantic-launch-review.csv` as the worksheet. Fill the query and
expected titles columns. For positives, list every paper you consider an
acceptable answer, separated by ` | `. Use the repository's exact titles;
record IDs will be resolved and checked before freezing. Duplicate titles must
be reviewed rather than automatically treated as interchangeable documents.

- Write queries the way a student would actually ask them, without copying
  titles. Use your knowledge of the corpus, not semantic search results.
- Include broad/ambiguous queries and near-topic negatives, not just subjects
  obviously absent from the repository.
- For `clean_negative`, leave expected titles empty and explain why none of
  the papers addresses the question in the notes column.
- Notes should explain what makes a paper acceptable. Multiple valid answers
  are allowed; do not force one target when the query is ambiguous.
- Do not use the old adviser/holdout queries or paraphrase their known misses.
- Mark every row reviewed. Do not include student personal information.

The proposed worksheet has 15 ordinary positives, five difficult positives,
and five negatives. These counts are a proposed review design, not sufficient
statistical proof of production reliability. Before execution, agree the
acceptance criteria, freeze query text/labels/policy and their hashes, and keep
results hidden until the review is complete. Do not tune on this new set after
opening results and still describe it as untouched validation.

## Frozen suite — 2026-10-10

The owner completed all 25 rows before launch-suite rankings were opened. The
review CSV SHA-256 is
`9bd9b057b8a231095e71ea7560bb238bc01f04ad53d9900c1c0aafea8b84f950`.
The machine-readable query/label file is
`services/processing/semantic_launch_queries.json`, SHA-256
`285cef35d48453386174d37fa7dc873a863d487e3336bc84648529f8a297a61a`.
It contains 15 positives, five hard positives, and five clean negatives. All
expected titles resolved against the frozen 178-record eligible staging corpus;
ten labels map to multiple same-title records, all of which are acceptable for
title-level scoring. Labels are now frozen. No post-result edit may retain the
claim that this is untouched launch validation.

## Frozen result — 2026-10-10

Preflight confirmed corpus snapshot
`27d166be4500324a5e5bc9feb496bf2799fa82431e072f239c46581e0d1ed420`, 178
records, 5,334 chunks, and zero missing/unindexed records without spending
quota. The suite ran in two bounded provider batches:

- `9bc81f54-f4e6-45fb-924b-2745db00d339` (20 probes), artifact SHA-256
  `1705ab3a0d281a2aa3f914c94db6b9b6e07fcf82a90883017a70e4e68c130119`;
- `622483f1-ff40-4404-82ea-ec57e4ba823b` (five probes), artifact SHA-256
  `028c985846d02c4d192cbd030ffd409c55cab992ce5a015191d0c02207729270`.

The frozen policy (`log_length_penalized_min`, penalty 0.02, maximum score
0.36) achieved 15/15 ordinary positive Hit@1, 5/5 hard-positive Hit@1, and 5/5
clean-negative abstention. There were no failed rows. Keyword-only Hit@1 was
65%; guarded record-level RRF retained 100% positive Hit@1. Because broad hard
queries list acceptable alternatives, launch scoring requires any approved
target at rank 1; it does not require every alternative to appear.

This passes the owner-reviewed launch suite for a restricted staging canary.
It does not erase the old adviser failure, prove general production relevance,
or complete institutional Stage 9 readiness. Monitor canary feedback and keep
keyword fallback and immediate rollback.

## Engineering work still required

1. Implement authenticated Worker-to-Cloud Run query embedding in
   `asia-southeast1`, with the Gemini secret only at the regional service.
2. Reserve quota before provider calls; prevent replay from spending twice;
   set timeouts, no automatic provider retries, and bounded service capacity.
3. Keep Neon authorization and retrieval in the Worker. The regional service
   needs query text only, not corpus files, Neon credentials, or R2 access.
4. Prove the exact deployed scoring/abstention path against saved vectors
   without paying to regenerate embeddings merely to test ranking SQL.
5. Run the frozen replacement evaluation, visibility tests, provider-failure
   fallback, latency/cost checks, and rollback drill before enabling a canary.

The service has now been implemented and provisioned keyless in staging; see
`docs/semantic-query-service.md`. Paid end-to-end transport validation remains pending.
Production institutional readiness remains separate from staging canary readiness.

## Seed provenance

The owner supplied p01/h01/n01 in conversation and stated they were authored
without consulting semantic rankings. Wording and expected titles are retained
verbatim in the worksheet (IDs mapped to launch IDs). The farmer topic and both
target papers were already discussed in the adviser diagnostics, so this seed
must not be represented as an entirely retrieval-blinded sample. No seed queries
have been submitted to the provider during transport development. Twenty-two
worksheet rows remain for reviewer completion; expected record identities and
corpus-wide negative judgments still need validation before freezing.
