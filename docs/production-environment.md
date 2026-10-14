# Production environment

## Status

**OWNER-APPROVED, PROVISIONING PENDING (2026-10-14).**

SULUAN will launch as a real production service temporarily owned, operated,
and billed by the project owner. Institutional handover remains required. The
production environment must not reuse development or staging data resources,
credentials, service identities, or storage objects even when all environments
share the owner's provider billing accounts.

## Approved launch topology

| Layer | Production resource |
|---|---|
| Frontend | Cloudflare Pages `suluan-repository.pages.dev` |
| API | Cloudflare Worker `suluan-api-production` |
| Storage | private R2 bucket `suluan-production` |
| Notifications | `suluan-notifications-production` + DLQ |
| Database | separate Neon project `suluan-production` in Singapore |
| Identity / compute | separate Google/Firebase project `suluan-production` |
| Processing | bounded Cloud Run Jobs/services in `asia-southeast1` |
| Source | private owner-controlled GitHub repository |

Workers Free is the approved initial Cloudflare plan. Upgrade review is
triggered by CPU-limit errors, a queue backlog approaching Free's 24-hour
retention, or sustained traffic above 70,000 Worker requests/day. Static assets
remain free; current staging traffic is far below the request ceiling.

## Access and AI policy

- Public visitors retain visibility-filtered keyword discovery and PUBLIC files.
- Any server-verified `ua.edu.ph` profile may use authenticated Semantic Search.
- Semantic Search is limited to 10 meaning-based queries/user/UTC day and 500
  aggregate/day. It uses a production-only quota bucket; exhaustion falls back
  to labeled keyword evidence.
- Any server-verified UA profile may use the Assistant after affirming that they
  are at least 18. Limits remain 10 messages/user/day, 300 aggregate/day, a
  10-second cooldown, 1,000 prompt characters, 10 turns, 800 output tokens, and
  five PUBLIC-only evidence chunks.
- Assistant retrieval has a separate 300-request/day pool. If exhausted, the
  Assistant may provide labeled general guidance without claiming a repository
  no-match. No provider call is automatically retried.
- The paid Gemini tier is required. PUBLIC-only evidence remains deliberately
  narrower than signed-in repository visibility. Users are warned not to submit
  personal, confidential, restricted, or unpublished information.
- Production uses the validated 0.36 confidence ceiling. The staging-only 0.40
  exploratory band is not authorized for production without fresh validation.

## Data initialization

Production starts from clean migrations and the approved institutional catalog.
Import the governed 139-paper legacy set once through the existing importer and
normal individual review workflow. Do not clone staging profiles, submissions,
audit history, generated fixtures, 36 duplicate pilot copies, usage counters,
or provider claims. Hash/manifests remain the corpus identity boundary.

## Ownership and administration

The project owner is the initial infrastructure, billing, deployment, and
application administrator. A separate recovery administrator should be added
before broad availability. First-admin bootstrap must be production-explicit
and audited; the development promotion script must not be pointed at production.
Subsequent role changes require ADMIN authorization, audit history, stale-write
protection, and a guard against removing the last administrator.

The temporary authorized UA Gmail mailbox remains the initial production sender
and REO mailbox. Rotation to an institutional mailbox is a required handover
item, not a code change.

## Provisioning and launch gates

1. Review accumulated changes, scan for secrets, pass all TypeScript/Python
   checks, and push reviewable commits to the private GitHub repository.
2. Create separate production Neon, Google/Firebase, Cloudflare, and Cloud Run
   resources. Attach existing billing accounts with project-specific alerts.
3. Apply migrations from empty with the direct Neon endpoint, pass `db:check`,
   prove no-op reapply, and verify a provider-supported restore into a temporary
   target before loading papers.
4. Configure only public Firebase values in the Pages build. Keep Neon, Gmail,
   Gemini, and service credentials in provider secret stores.
5. Deploy the Worker keyless first; verify health, anonymous denials, exact CORS,
   and workload identity before attaching Gemini/Gmail credentials.
   Migrate the Assistant from `gemini-3-flash-preview` to an owner-approved
   stable model and rerun its structured-output/citation canary first; current
   Google guidance recommends stable `gemini-3.6-flash` as that preview's
   replacement, while `gemini-3.8-flash` is the newest stable Flash model.
6. Provision and verify the owner administrator, then a separate recovery admin.
7. Import the authorized corpus, individually review it, process/index/embed it,
   and reconcile hashes/counts with no staging/test rows.
8. Run access, leakage, idempotency, queue/DLQ, restore, quota, AI citation,
   prompt-injection, rollback, direct-route, and mobile/desktop smoke checks.
9. Launch with active billing/usage review. Immediate rollback is disabling the
   Pages deployment, Worker AI service URLs, or production Worker route without
   deleting authoritative Neon/R2 data.

### First administrator command

After the owner signs in once through the production Firebase project, use the
production Neon **direct** endpoint and an exact host/phrase confirmation:

```powershell
$env:SULUAN_ENVIRONMENT = 'production'
npm run db:bootstrap-admin:production -- --email owner@ua.edu.ph --expected-host '<direct-neon-host>' --confirm 'BOOTSTRAP owner@ua.edu.ph IN PRODUCTION'
```

The command refuses pooled endpoints, refuses a second bootstrap, and writes
`role.bootstrap_admin` to `audit_events` in the same transaction. Later changes
must use `/admin/users`; do not use `db:promote-admin` outside development.
