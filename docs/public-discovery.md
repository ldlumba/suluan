# Public discovery, visibility, and submitter status

## What changed (2026-10-01)

- **Search is public.** `/search` works signed out. Results are filtered by
  each record's visibility; the "Prepare extracted papers" button stays
  manager-only because it writes keyword snapshots.
- **Per-paper visibility** is set when a manager accepts: `PUBLIC` (default),
  `UA_ONLY`, or `RESTRICTED`.
- **Optional embargo date** auto-lifts a restricted paper to public. It only
  appears for non-public visibility, and a date on a PUBLIC paper is ignored.
- **Public downloads** of accepted public papers are served from
  `GET /api/records/:id/download`.
- **My submissions** (`/submissions`) shows each submitter their own papers,
  status, and reviewer remarks. It does not grant file access.

## Manual checks

1. Restart `npm run dev:worker` and `npm run dev`.
2. **Signed out:** open `/search`. You should see only PUBLIC papers, no
   "Prepare" button. Sign out of the app entirely (or use a private window) to
   confirm the public path.
3. As a manager, accept a paper with **University access** + an embargo date
   two days out. It should appear for signed-in UA users labeled
   "University access only", and be hidden from signed-out visitors.
4. Accept one with **Public** and confirm it is downloadable while signed out.
5. Accept one with **Restricted** — confirm it is invisible to visitors and to
   ordinary UA users, but downloadable by a manager.
6. As the submitter, open `/submissions`: status and remarks appear, and the
   paper file is still not downloadable (that stays a manager action).

## Notes and limits

- Public search responses are cached for 30 seconds; signed-in responses are
  `private, no-store` because they depend on role.
- Restricted records return the same 404 as a missing record so IDs cannot be
  probed.
- A valid UA token from a non-UA domain is rejected, not silently downgraded.
- Visibility is evaluated at read time; an embargo lifts access automatically
  with no scheduled job.
- Existing papers default to PUBLIC.
- Search remains keyword-only. Semantic search, embeddings, and the Cloud Run
  pipeline are still deferred (no billing account, no Gemini key in use yet).
