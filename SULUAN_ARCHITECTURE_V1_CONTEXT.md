# SULUAN Architecture v1 — Project Context

Prepared: 2026-09-30. Intended use: durable context for an OpenCode `AGENTS.md` setup.

Source: [SULUAN Architecture Costs](chatgpt-conversation://6abb9873-b938-83ec-a9cb-3e61781c865a). This consolidates the available conversation, including the client's workflow clarification and the architecture subsequently named **SULUAN Architecture v1**. The manuscript referenced there was not supplied for independent review. Architecture coverage is a design assessment, not evidence of completed implementation or client acceptance testing.

## 1. Decision status and project purpose

- **LOCKED** means the finalized v1 baseline: preserve it unless the project owner explicitly changes the decision.
- **IMPLEMENTATION RULE** means a safeguard needed to realize that baseline; it does not imply an existing implementation or a separately approved institutional policy.
- **PROPOSED / TBD** means a recommendation, configuration choice, or unresolved requirement. Do not silently promote it into a locked decision.

SULUAN is an institutional research submission, repository, discovery, and research-intelligence platform for UA and its REO. Its lifecycle is submission → review → governance/archive → indexing → discovery, connections, analytics, and evidence-grounded assistance.

This is the baseline for a greenfield build. Earlier Supabase or prototype assumptions are superseded. Do not carry over prototype schemas, authentication rules, upload behavior, or infrastructure merely because earlier code used them.

## 2. LOCKED: technology and responsibility boundaries

| Component | Responsibility |
|---|---|
| React + Vite | Web frontend |
| Cloudflare static hosting | Serve the frontend; exact Pages versus Workers static-assets configuration is TBD |
| Cloudflare Workers | API, identity verification, authorization, workflow, quotas, signed file access, and orchestration |
| Cloudflare Queues | Background processing and notification jobs |
| Neon PostgreSQL | Authoritative application data, roles, workflow state, metadata, provenance, relationships, analytics, and usage accounting |
| PostgreSQL full-text search + pgvector | Keyword retrieval, filters, and vector retrieval within Neon |
| Cloudflare R2 | Private PDF/DOCX storage; authoritative document copy |
| Firebase Authentication | Google Sign-In and identity; application permissions remain in Neon and are enforced by Workers |
| Google Cloud Run | On-demand document extraction and ingestion; Python with PyMuPDF and python-docx is the selected processing approach |
| Gemini | Embeddings and a limited, evidence-grounded Research Assistant |
| Google Workspace / Gmail API | Submission and decision notifications; institutional sender authorization is still required |
| Crossref, OpenAlex, OpenCitations | Scholarly metadata/citation enrichment where available |
| React Flow / Recharts | Knowledge Graph presentation / descriptive analytics presentation |

The primary request path is browser → Workers → authorized services. Accepted-document processing runs through Queues → Cloud Run → R2 extraction → Gemini embeddings → Neon. Notification jobs use Gmail API. Concrete authenticated queue-to-Cloud-Run delivery is an implementation choice, not an already configured connection.

Do not add Supabase, a separate vector or graph database, Elasticsearch, MongoDB, Redis, RabbitMQ, an analytics warehouse, Kubernetes, a VPS, or a custom auth/email server without a demonstrated new requirement and an explicit architecture revision. OpenCode is development tooling; OpenAI API access is not a SULUAN runtime dependency.

## 3. LOCKED: client-validated submission and review workflow

1. A student or faculty member signs in with an authorized UA Google account and submits metadata plus a shortened PDF/DOCX paper. Proposed form fields are title, authors, school, course, year, research type, and document. The exact required-field list remains TBD. School/course options belong in Neon; course choices depend on school.
2. The Worker authorizes a temporary direct browser-to-R2 upload. After verifying completion, SULUAN persists a `PENDING` submission in Neon and schedules the REO email. The notification contains submission metadata, a review link, and the paper when it fits the configured email allowance.
3. REO may read and assess the paper through SULUAN or its existing mailbox workflow. The authoritative acceptance/rejection is recorded in SULUAN by an authorized repository manager. Reading email does not change state; automatic email-reply decisions are not specified.
4. REO must enter remarks before either decision. Persist the decision, remarks, reviewer, time, and audit event, then schedule the submitter notification.
5. **Accept:** create the repository record linked to the existing R2 object and schedule ingestion. Extract/normalize text, capture available metadata, chunk, embed, and store retrieval data in Neon. Do not make the reviewer wait for extraction, Gemini, or email.
6. **Reject:** retain the submission in an REO-only archive. Do not index it, embed it, expose it to public discovery, or include it in public graphs, analytics, or AI evidence.

The core decision states are `PENDING`, `ACCEPTED`, and `REJECTED`. Keep review state separate from ingestion state: an accepted paper may be awaiting processing, `PROCESSING`, `INDEXED`, or awaiting recovery after failure. Exact ingestion enum names and retry states are TBD. A processing failure must not undo acceptance.

Accepted records may appear in authorized metadata/keyword discovery while indexing completes. Semantic retrieval, assistant evidence, and similarity-derived graph connections require **ACCEPTED + INDEXED**, plus the applicable visibility permissions.

`RETURNED_FOR_REVISION` and resubmission/versioning workflows are optional future scope, not synonyms for rejection or locked v1 states.

## 4. LOCKED: access model

| Actor | Access baseline |
|---|---|
| Public visitor | Browse/search authorized public records; see permitted metadata, abstracts, public graph, and public descriptive analytics |
| Authenticated UA `USER` | Public capabilities plus authorized file downloads, research submission, and the limited AI Assistant |
| `REPOSITORY_MANAGER` | User capabilities plus REO review, acceptance/rejection with remarks, restricted submission access, metadata editing, and repository management |
| `ADMIN` | Manager capabilities plus role management, system configuration, and administrative controls |

Students and faculty share the `USER` security role. `STUDENT_RESEARCH` / `FACULTY_RESEARCH` describe research categories, not separate privilege levels. Restricted/rejected submission content is for authorized REO management, never ordinary users or the public. Any submitter-facing status/remarks view needs an explicit policy; do not infer document access from submission ownership.

Authentication does not grant unrestricted document access. Confidential, unpublished, copyrighted, embargoed, or otherwise restricted material requires explicit authorization. Apply visibility rules to search results, snippets, downloads, graphs, analytics, and AI retrieval. Public search does not imply public assistant use or unrestricted files. Exact public semantic-search limits and non-UA/alumni access are TBD.

## 5. Data, discovery, and implementation principles

**LOCKED domain separation:** submission data and published research data are distinct concepts in the same Neon database. Acceptance is the explicit bridge. Never make uploads immediately searchable or eligible as AI evidence.

Logical domains to represent (names below are illustrative, not a frozen schema):

- Identity/organization: profiles, roles, schools, courses.
- Intake: submissions, submission files, decisions, reviewer remarks.
- Repository: research records, files, authors, author links, metadata and provenance.
- Retrieval: document chunks, embeddings, indexing state/version.
- Relationships: topics, keywords, themes, citations, related research, organizational links.
- Operations: audit events, processing jobs, notifications, AI usage, activity events and aggregates.

**LOCKED feature principles:**

- Hybrid discovery combines Gemini embeddings, pgvector, PostgreSQL full-text search, and metadata filters. Do not embed the corpus again on every query.
- The assistant retrieves authorized, accepted, indexed evidence; explains relevance; links supporting SULUAN records; and acknowledges insufficient evidence. A small evidence selection (the conversation suggests 3–5 chunks) is a starting point, not a fixed quota or retrieval specification.
- The Knowledge Graph uses PostgreSQL relationship tables. Keep actual citation relationships distinguishable from inferred similarity.
- Analytics are descriptive: collection growth, year/school/course/topic distributions, views, downloads, citation metadata, and other agreed activity counts. Do not expand this into predictive evaluation or research-quality scoring.
- Enrich citation metadata through the selected APIs, validate/cache results, and permit manual entry. Generate APA, BibTeX, and RIS where metadata supports them. Do not promise Google Scholar scraping, complete citation counts, or DOI coverage for every paper.
- Keep provenance for submission, decisions, metadata/file changes, publication, and role changes. Include actor, action, entity, timestamp, and relevant context.
- Support authorized legacy imports. Journal/alumni integration is mentioned in the scope summary, but its concrete workflows remain TBD.

**IMPLEMENTATION RULES:**

- Neon owns workflow state; email is a notification/convenience channel. Save first, send asynchronously. Failed email must never lose a submission or decision. Retry notifications without repeating acceptance/rejection.
- Use a durable handoff from database changes to queued work (for example, a transactional outbox). Make retried jobs and repeated requests safe from duplicate records, embeddings, and avoidable notifications.
- Keep one authoritative R2 object when accepting a submission; do not copy the same file merely to represent a status change. Email attachments are convenience copies.
- For an oversized attachment, send metadata and an authenticated review link. Email limits must not decide whether an otherwise valid submission succeeds.
- Track processing and notification outcomes separately and provide operational recovery. Restrict heavy PDF/DOCX parsing to Cloud Run, not request-bound Workers.

## 6. Security rules for implementation

- Verify Firebase tokens server-side; enforce the approved UA identity/domain policy and Neon permissions on every protected operation. Exact UA domains are TBD; example addresses in the source are not configuration.
- Never trust client-supplied roles, ownership, workflow states, file keys, or hidden UI controls as authorization. Ordinary users cannot grant themselves REO/Admin access.
- Keep R2 private. Issue short-lived, scoped upload/download URLs only after authorization; verify uploaded object ownership and file constraints before finalizing submissions. Do not store document blobs in Neon or expose storage credentials to the browser.
- Keep Gemini, database, storage, service-account, and Gmail OAuth secrets in server-side secret facilities. Commit placeholders only; exclude local secret files and redact sensitive logs. Firebase public client configuration is distinct from privileged credentials.
- Authenticate background-service calls and give each component only the permissions it needs. Do not expose Cloud Run ingestion as an unrestricted public trigger.
- Use authorized OAuth/API access for the sending mailbox; never request REO's Gmail password or use shared team passwords.
- Enforce assistant quotas/rate limits server-side before paid work. Treat uploaded text and retrieved content as untrusted data, not instructions that override permissions or assistant behavior.
- Preserve auditability. Do not enable automatic rejected-file deletion until REO approves retention requirements.

## 7. Cost controls and planning assumptions

Latest client observation: **148 PDF/DOCX files totaling approximately 800 MB** in the 2026 archive. This supersedes the earlier approximate 900 MB figure. At similar file sizes, 200 submissions/year imply about 1.1 GB/year; use **1.5 GB/year** as a conservative archive-growth assumption, not a hard cap or measured total-system footprint.

| Planning quantity | Estimate |
|---|---:|
| Submissions per year | 200 |
| Core outgoing email: REO notification + one decision | 400/year; 1,200 over three years |
| With optional submitter receipt | 600/year; 1,800 over three years |
| Three years at 1.5 GB/year | 4.5 GB of archive documents |

Budget separately for pending/rejected files, legacy imports, replacements, backups, extracted text, vectors, mailbox storage, and operations. These projections do not establish total database or AI cost. Assistant usage depends on user traffic, not just annual submissions.

The conversation anticipated low email/storage/ingestion costs and cited then-current free allowances, including R2's 10 GB-month allowance. Those are historical planning assumptions, **not verified current pricing, a guaranteed free deployment, or locked provider limits**. Recheck official pricing, billing prerequisites, quotas, and mailbox limits when activating each service.

**Controls:** start with free plans where feasible; no paid upgrades during bootstrap; connect services only when needed; embed accepted documents once per relevant content/model change; reuse files; cache appropriate results/metadata; bound assistant requests, context, output, and retries; monitor usage and configure budgets/alerts before enabling billable work. Exact quotas, models, spend ceilings, and enforcement mechanisms are TBD. A budget alert alone is not a hard spending cap.

## 8. Cloud accounts, ownership, and credential rollout

Prepare GitHub, Cloudflare, Neon, and one Google account. A team GitHub organization is recommended. One Google Cloud/Firebase development project should group Firebase Auth, Cloud Run, Gmail API, and Gemini access; use/import that project in AI Studio instead of creating unrelated projects. Names such as `suluan-dev` are suggestions, not existing resources.

- **GitHub:** repository, collaboration, reviews, and eventual CI; individual member accounts.
- **Cloudflare:** static hosting, Workers, Queues, R2. Activate R2 when storage work starts; verify its subscription/billing setup then.
- **Neon:** development project at the database stage; production separation before live institutional use.
- **Google:** Firebase/Cloud project for development; enable additional APIs and any required billing only at their stage. Use a test mailbox first. REO/UA must authorize the production sender.
- **Development agent access:** configure OpenCode separately; its model/provider credentials are not SULUAN application credentials. Prior ChatGPT/Codex access does not establish OpenCode provider access.

Enable MFA and add a second trusted administrator where possible. Team-administered development accounts may be used initially; institutional administrators, credential control, and billing ownership must be arranged for adoption. Do not leave production permanently dependent on one student's personal account. Separate development and production resources/credentials; the source recommends separate Neon projects.

No Supabase account, paid vector/graph service, paid email provider, VPS, custom domain, or paid Workers/Neon upgrade is needed merely to begin the build.

## 9. Development stages

Only Stage 0–2 numbering is established in the source. Later rows are a **proposed dependency order**, not a previously approved numbered roadmap.

| Stage | Deliverable / credential boundary |
|---|---|
| **0 — Local bootstrap** | React/Vite scaffold, repository layout, documentation and agent guidance, local configuration placeholders, test/check setup. No production access or full cloud-secret bundle. |
| **1 — Database** | Neon development connection, migrations, domain separation, roles, organization data, workflow/audit foundations. Supply development database credentials only. |
| **2 — Authentication** | Firebase development setup, Google identity validation, Worker authorization, and role boundaries. |
| Proposed: submission/review + email | Private R2 uploads, pending intake, remarks and decisions, durable jobs, Gmail test authorization, failure recovery. |
| Proposed: document processing | Cloud Run extraction and indexing-state management, authenticated queue delivery, retriable ingestion. |
| Proposed: semantic search | Add Gemini development credentials, embeddings/pgvector, hybrid retrieval and filters; retain useful metadata discovery during ingestion failure. |
| Proposed: assistant and research tools | Enforced AI limits, cited answers, graph, descriptive analytics, citations, and agreed import/integration scope. |
| Proposed: pilot readiness | Workflow/access validation, recovery and backup checks, cost monitoring, institutional sender/ownership, and production configuration. |

Complete and verify each dependency before expanding scope. Important checks include denied role escalation, cross-user/restricted-file access, pending/rejected retrieval leakage, duplicate queue deliveries, email failures, and ingestion failures after acceptance. Use development fixtures/resources for these checks.

## 10. Open / TBD decisions

- Exact UA Google domains, identity verification policy, alumni/non-UA access, and first-admin provisioning.
- Final metadata requirements, school/course catalogs, visibility/embargo rules, download permissions, and submitter status access.
- Whether revisions/returns are needed; rejected-file retention; replacement, withdrawal, deletion, and backup/restore policies.
- Upload size/type validation, document security checks, OCR/scanned-document handling, and large-file processing limits.
- Production sender/receiving mailbox, OAuth/admin authorization, attachment allowance, templates, and optional submission receipts.
- Exact Gemini models, vector dimensions, chunking/relevance settings, AI quotas, public semantic-search limits, privacy/data-processing approval, and spend ceiling.
- Concrete schema, libraries/ORM, hosting mode, regions, authenticated queue delivery, retries/dead-letter handling, observability, and deployment/CI commands.
- Detailed legacy-import, journal/alumni integration, citation enrichment, and analytics event/retention requirements.
- Production ownership, billing, domain, rollout criteria, and the detailed post-Stage-2 schedule.

## 11. Use from AGENTS.md

Store this file in the repository documentation and reference its actual path from `AGENTS.md`. Tell OpenCode to read it before architecture/schema work, preserve locked decisions, and keep TBD items explicit. Add repository-specific build/test commands only after inspecting the real project. Record approved changes to this baseline with rationale and date.

Do not treat this document as proof that accounts, cloud resources, tables, integrations, or tests already exist. Implement the governed submission workflow before exposing AI features; use the smallest service set that satisfies it.
