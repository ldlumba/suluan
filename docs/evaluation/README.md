# External evaluation evidence

This directory is the entry point for an independent software-quality review.
It does not claim ISO/IEC certification or replace the evaluator's rubric.

- [`iso-25010-evidence-matrix.md`](iso-25010-evidence-matrix.md) maps current
  evidence and known gaps to both ISO/IEC 25010:2011 and 25010:2023.
- [`requirements-test-traceability.md`](requirements-test-traceability.md)
  links the principal SULUAN requirements to implementation boundaries,
  automated tests, and residual verification needs.

## Evaluated baseline

- Source commit: `c9e9b22` (`chore: prepare repository for evaluation`)
- Public application: <https://suluan-repository.pages.dev>
- API health: <https://suluan-api-production.ctrlfinder.workers.dev/api/health>
- Evidence refresh date: 2026-10-28

The source commit is authoritative for repository evidence. At the refresh
date, deployment of this final cleanup commit was blocked before upload by an
expired local Cloudflare login. The live system therefore must not be assumed
to contain `c9e9b22` until a later deployment identifier is recorded.

## Reproduce the credential-free checks

From a clean clone with Node.js 22, npm 10, and Python 3.13:

```bash
npm ci
npm run check
npm run format:check
npm run build
python -m unittest discover -s services/processing -v
python -m unittest discover -s services/importer -v
```

Observed on 2026-10-28:

- 80 web tests passed.
- 123 Worker tests passed; 97 database-dependent tests skipped without a
  database.
- The database package test skipped without `DATABASE_URL`.
- 77 Python tests passed across processing and importer services.
- Lint, strict TypeScript checking, formatting, and the production frontend
  build passed.
- The build reported a large main JavaScript chunk; this remains a performance
  risk, not a failed functional test.

Skipped tests are not passes. Database integration evidence requires an
explicitly authorized isolated target or controlled production-safe procedure.

## Evaluator handling rules

- Use only the temporary account assigned to you; do not share credentials.
- Do not upload real personal, confidential, copyrighted, or sensitive papers.
- Do not change roles, catalog availability, or repository processing unless
  the owner explicitly includes those actions in the evaluation script.
- Treat production data as live institutional data. Avoid destructive or load
  testing against production.
- Record browser, device, timestamp, source commit, live deployment identifier,
  input, expected result, actual result, and screenshots/logs for each finding.
- Report security findings privately to the repository owner.
