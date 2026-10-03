import { sql } from 'drizzle-orm'
import type { Db } from './db'

/**
 * Multi-row atomicity without interactive transactions. The neon-http
 * driver is stateless (one fetch per query), so `db.transaction()` throws.
 * Instead each write path below is a SINGLE statement built from
 * data-modifying CTEs — Postgres executes it atomically. Concurrent
 * duplicates are arbitrated by unique constraints (idempotency_key,
 * decisions.submission_id), never by read-then-write.
 */

export interface NewSubmissionInput {
  submitterId: string
  idempotencyKey: string
  title: string
  authors?: string
  schoolId?: string
  courseId?: string
  r2Key: string
  fileName: string
  mimeType: string
  sizeBytes: number
  submitterEmail: string | null
}

export async function createSubmissionAtomic(
  db: Db,
  input: NewSubmissionInput,
): Promise<{ submissionId: string; outboxId: string }> {
  const payload = JSON.stringify({
    submissionId: undefined,
    title: input.title,
    submitterEmail: input.submitterEmail,
  })
  const result = await db.execute(sql`
    WITH new_submission AS (
      INSERT INTO submissions
        (submitter_id, status, idempotency_key, title, authors, school_id,
         course_id)
      VALUES (${input.submitterId}, 'PENDING', ${input.idempotencyKey},
        ${input.title}, ${input.authors ?? null}, ${input.schoolId ?? null},
        ${input.courseId ?? null})
      RETURNING id
    ),
    new_file AS (
      INSERT INTO submission_files
        (submission_id, r2_key, file_name, mime_type, size_bytes)
      SELECT id, ${input.r2Key}, ${input.fileName}, ${input.mimeType},
        ${input.sizeBytes}
      FROM new_submission
    ),
    new_audit AS (
      INSERT INTO audit_events (actor_id, action, entity_type, entity_id)
      SELECT ${input.submitterId}, 'submission.created', 'submission',
        id::text
      FROM new_submission
    ),
    new_outbox AS (
      INSERT INTO outbox_events
        (aggregate_type, aggregate_id, event_type, payload)
      SELECT 'submission', id::text, 'submission.created',
        (${payload}::jsonb || jsonb_build_object('submissionId', id::text))
      FROM new_submission
      RETURNING id
    )
    SELECT ns.id AS "submissionId", no.id AS "outboxId"
    FROM new_submission ns, new_outbox no
  `)
  const row = result.rows[0] as { submissionId: string; outboxId: string }
  return { submissionId: row.submissionId, outboxId: row.outboxId }
}

export interface NewDecisionInput {
  submissionId: string
  reviewerId: string
  status: 'ACCEPTED' | 'REJECTED'
  remarks: string
  title: string
  r2Key: string
  fileName: string
  mimeType: string | null
  submitterEmail: string | null
  /** Managers set visibility on acceptance; ignored for REJECTED. */
  visibility?: 'PUBLIC' | 'UA_ONLY' | 'RESTRICTED'
  /** Optional auto-lift date; only meaningful for restricted visibilities. */
  embargoUntil?: string | null
}

/**
 * Single-statement decision. The UPDATE is guarded by status='PENDING'
 * and every subsequent CTE selects FROM it — if another decision won the
 * race, all inserts select zero rows and the caller sees no decision row.
 */
export async function recordDecisionAtomic(
  db: Db,
  input: NewDecisionInput,
): Promise<{ outboxId: string } | null> {
  const accepted = input.status === 'ACCEPTED'
  // An embargo date on a PUBLIC record is meaningless (already public), and
  // the schema rejects past dates; the route validates before this point too.
  const visibility = input.visibility ?? 'PUBLIC'
  const embargo =
    visibility === 'PUBLIC' || !input.embargoUntil ? null : input.embargoUntil
  const payload = JSON.stringify({
    status: input.status,
    title: input.title,
    remarks: input.remarks,
    submitterEmail: input.submitterEmail,
    visibility,
    embargoUntil: embargo,
  })
  const result = await db.execute(sql`
    WITH upd AS (
      UPDATE submissions
      SET status = ${input.status}, updated_at = now()
      WHERE id = ${input.submissionId} AND status = 'PENDING'
      RETURNING id
    ),
    new_decision AS (
      INSERT INTO decisions (submission_id, reviewer_id, status, remarks)
      SELECT id, ${input.reviewerId}, ${input.status}, ${input.remarks}
      FROM upd
      RETURNING submission_id
    ),
    new_record AS (
      INSERT INTO research_records
        (submission_id, title, year, visibility, embargo_until)
      SELECT id, ${input.title}, extract(year from current_date)::integer,
        ${visibility}, ${embargo}
      FROM upd
      ${accepted ? sql`` : sql`WHERE false`}
      RETURNING id
    ),
    new_record_file AS (
      INSERT INTO record_files (record_id, r2_key, file_name, mime_type)
      SELECT nr.id, ${input.r2Key}, ${input.fileName}, ${input.mimeType}
      FROM new_record nr
    ),
    new_processing_job AS (
      INSERT INTO processing_jobs (record_id)
      SELECT id FROM new_record
    ),
    new_audit AS (
      INSERT INTO audit_events
        (actor_id, action, entity_type, entity_id, context)
      SELECT ${input.reviewerId},
        ${accepted ? 'submission.accepted' : 'submission.rejected'},
        'submission', id::text,
        jsonb_build_object('remarks', ${input.remarks}::text)
      FROM upd
    ),
    new_outbox AS (
      INSERT INTO outbox_events
        (aggregate_type, aggregate_id, event_type, payload)
      SELECT 'submission', id::text, 'decision.made',
        (${payload}::jsonb || jsonb_build_object('submissionId', id::text))
      FROM upd
      RETURNING id
    )
    SELECT no.id AS "outboxId" FROM new_outbox no
  `)
  if (result.rows.length === 0) return null
  return { outboxId: (result.rows[0] as { outboxId: string }).outboxId }
}
