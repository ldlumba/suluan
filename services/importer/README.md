# Legacy paper importer

This local operator tool imports an authorized folder of existing papers through
the normal Worker submission endpoint. It never writes directly to Neon or R2,
never accepts a paper, and never triggers indexing or embeddings. Every confirmed
result remains `PENDING` for REO review, attributed to the signed-in manager who
runs the command.

## Folder contract

Each supported document has a same-directory, same-stem Markdown manifest:

```text
papers/
  tourism-awareness.md
  tourism-awareness.pdf
  nursing-outcomes.md
  nursing-outcomes.docx
```

Copy `services/importer/manifest-template.md` as the starting point for each
paper, then rename it to match the document stem.

PDF and DOCX are accepted up to 30 MiB. Legacy `.doc` files are reported and
must be converted to DOCX before import. Subfolders are supported. A document
without a matching manifest is an error; an unmatched Markdown file is a warning
and is ignored.

```markdown
---
title: |
  The complete public research title
authors:
  - Dela Cruz, Juan A.
  - Santos, Maria L.
school: School of Business
course: BS Tourism Management
---

Optional operator notes may follow, but are not imported or shown to reviewers.
```

`title` is required. `authors`, `school`, and `course` are optional. Names must
match the API catalog exactly. A unique course can infer its school, but stating
both is recommended. Unknown fields are rejected so misspellings do not silently
lose metadata. Year is assigned at acceptance; research type and abstract are
not manifest fields.

## Setup (PowerShell, from repository root)

```powershell
python -m venv services/importer/.venv
services/importer/.venv/Scripts/python.exe -m pip install -r services/importer/requirements.txt
```

Obtain a fresh manager Firebase ID token from an authenticated browser request:
DevTools → Network → a successful `/api/me` request → Authorization header. Copy
only the value after `Bearer`. Treat it as a temporary password: never paste it
into chat, save it in a manifest/report, or pass it on the command line.
The importer checks `/api/me` and stops unless the token belongs to a repository
manager or admin.

## Mandatory dry run

The command defaults to dry-run mode and prompts for the token without echoing it:

```powershell
services/importer/.venv/Scripts/python.exe services/importer/importer.py `
  "D:\path\to\papers" `
  --api https://suluan-api.ctrlfinder.workers.dev
```

It validates every manifest and file, resolves the live catalog, hashes every
document, and writes `suluan-import-report.json` in the supplied folder. It
uploads nothing. Resolve every error and review the report before proceeding.
Warnings do not block the run but must still be reviewed.

## Apply

Add `--apply` only after a zero-error dry run:

```powershell
services/importer/.venv/Scripts/python.exe services/importer/importer.py `
  "D:\path\to\papers" `
  --api https://suluan-api.ctrlfinder.workers.dev `
  --apply
```

Uploads are sequential and paced one second apart. The report is checkpointed
after every confirmed response. The first failed/uncertain request stops the run;
there is no automatic retry. Rerunning is safe: the idempotency UUID is derived
from the API origin, relative document path, and file SHA-256, so confirmed files
replay instead of duplicating. A different production API origin receives a
different key, allowing the authorized corpus to be imported once per environment.

Changing manifest metadata after a confirmed upload does not update the existing
submission because its deterministic key replays the original row. Correct the
metadata before `--apply`; later corrections require a separately governed path.

The current review queue returns 50 pending papers at a time. For a 100+ paper
import, accepting older rows reveals the next pending batch.

## Tests

```powershell
services/importer/.venv/Scripts/python.exe -m unittest discover -s services/importer -v
```
