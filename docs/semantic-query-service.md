# Regional query embedding service

## Implemented boundary

Worker quota reservation precedes a 60-second random ticket stored in existing
`embedding_claims` (`kind=query`, `transport=interactive-v1`). The payload holds
a SHA-256 query digest, not query text. The ticket and query are sent via HTTPS
POST to a fixed configured Cloud Run origin. The regional service obtains its
Google metadata ID token and calls `/api/internal/query-tickets/redeem`.

That callback verifies a separately pinned query service account/audience and
atomically consumes the ticket. Only one concurrent redemption succeeds. The
service checks the query digest before one `RETRIEVAL_QUERY` Gemini call. No
retry/refund follows failure. Worker validates the returned vector and performs
visibility-aware retrieval. Regional failure does not fall back to direct Gemini
egress. Worker invalidates unredeemed tickets when transport finishes or fails.

Cloud Run ingress is reachable without Google IAM invoker authentication;
**application-level single-use tickets authorize embedding work**. This avoids
Google service-account keys/shared secrets in Workers. Callback identity is
Google-authenticated. The service account has no processing, Neon, R2, or secret
access granted yet. This public HTTP surface can incur compute on invalid
requests; bounded instances are not a guarantee of zero abuse cost. Review
ingress abuse protection before public production activation.

The service returns generic errors and does not log queries/tickets/provider
bodies. Current ticket rows retain query hashes; production retention/cleanup
must be resolved before launch. No query-result cache is implemented.

## Keyless staging evidence (2026-10-10)

- Service: `suluan-query-staging`, `asia-southeast1`.
- Identity: `suluan-query@suluan-staging.iam.gserviceaccount.com`.
- Image: `sha256:de817d775c519df7e62b0091a6a12b18632aafd0d016063410a87db4ba15259c`.
- Build: `3a434f32-0636-40ef-a539-00b6b26f61ad`.
- Revision: `suluan-query-staging-00001-r5w`.
- Origin: `https://suluan-query-staging-ciouwoqdoq-as.a.run.app`.
- Minimum instances 0, maximum 1, concurrency 4, CPU 1, memory 512 MiB,
  request timeout 60 seconds. Worker transport timeout is 55 seconds.
- Worker `9ad8bada-ef42-440f-8852-94fe7211bbf4` has callback identity configured,
  but **no QUERY_EMBEDDING_URL**, so interactive semantic remains unconfigured.
- `/health` returned 200; a synthetic `/embed` request returned generic 503 with
  no Gemini key. This is not evidence of a successful paid round trip.
- Tests: all workspace checks passed (173 Worker tests), 53 processing tests
  passed, including atomic concurrent redemption and query-tampering denial.

## Outstanding launch checks

Complete reviewer labels and preregister the policy before scoring the new suite.
Validate the exact regional request/callback/provider path with a bounded,
temporary secret attachment and verify timeout, failure, and rollback behavior.
Do not re-embed already saved evaluation vectors just to check ranking SQL.
Measure cold-start latency, resolve bounded provider/callback timeouts and
ingress abuse/retention controls, and verify current-snapshot eligibility before
production. Public canary and institutional production gates remain unpassed.

Rollback: remove `QUERY_EMBEDDING_URL` from the Worker and detach the service
Gemini secret. Keep the Worker without its own Gemini key, so disabling the
regional path cannot reactivate unsupported direct egress.

### Paid transport evidence — 2026-10-10

Three synthetic attempts each reserved quota and consumed a single-use ticket.
The first two failed before reaching Cloud Run because this Workers runtime
rejected browser-style fetch timeout/redirect options; no Gemini call occurred.
The fixed-origin fetch was simplified and the third attempt completed Worker →
regional service → Google-authenticated callback → Gemini → Worker retrieval in
4.675 seconds. Its unrelated synthetic query safely returned zero results at
the 0.36 ceiling with `semanticStatus: ready`. All three tickets were consumed,
none remained active, and usage reached 6 requests/44 inputs before the launch
evaluation. The secret and URL were removed immediately after this smoke test.

The first canary sets `SEMANTIC_AUTHENTICATED_ONLY=true`. Anonymous semantic
requests return `authentication_required` before quota/provider work and the UI
falls back to keyword results. Public paid semantic limits remain TBD.

## Authenticated staging canary activated — 2026-10-10

Worker `dd8c6d77-5ec0-45c8-b638-6d0d2afe93d0` activated the regional URL,
length-penalized scorer, 0.36 ceiling, and authenticated-only gate. Cloud Run
revision `suluan-query-staging-00005-ntj` holds the staging Gemini secret; the
Worker has no Gemini key. The evaluator Job remains preflight-only with no
secret. An anonymous live request returned `authentication_required` and did
not change usage. Post-evaluation usage was 8 requests/69 inputs with zero
active claims. This is a staging canary, not production activation.

The first owner browser check returned the expected tuberculosis and AgriKlima
papers at rank 1 and abstained for “Invasion of Countries.” It also exposed
duplicate-title corpus copies as duplicate cards. Semantic presentation now
collapses normalized exact-title copies after visibility filtering, retaining
the best-scoring record with stable ID tie-breaking. This affects presentation
only; no repository records or derivatives are deleted or merged.

The owner reran both affected queries after Worker
`dd8c6d77-5ec0-45c8-b638-6d0d2afe93d0` deployed the presentation fix. Each
showed exactly one expected card: the tuberculosis paper and AgriKlima,
respectively. This completes the manual authenticated browser canary check.
Final same-day evidence was 13 requests/74 inputs and zero active claims.
