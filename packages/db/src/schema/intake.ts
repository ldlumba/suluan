import {
  bigint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { courses, profiles, schools } from './identity'

/**
 * LOCKED decision states (Architecture v1 §3). RETURNED_FOR_REVISION is
 * optional future scope — do not add it here.
 */
export const submissionStatus = pgEnum('submission_status', [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
])

/**
 * Intake domain. Physically separate tables from the repository domain:
 * acceptance is the only bridge. Uploads are NEVER searchable here.
 * Exact required metadata fields are TBD — nullable columns below are
 * intentionally permissive until the form contract is locked.
 */
export const submissions = pgTable('submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  submitterId: uuid('submitter_id')
    .notNull()
    .references(() => profiles.id),
  /**
   * Authoritative review state, owned by the submission itself. A PENDING
   * submission has no decisions row yet; ACCEPTED/REJECTED mirror the
   * recorded decision. Never derive this client-side.
   */
  status: submissionStatus('status').notNull().default('PENDING'),
  /**
   * Client-generated UUID per submission attempt. Retried finalizations
   * with the same key return the existing submission instead of creating
   * a duplicate.
   */
  idempotencyKey: text('idempotency_key').notNull().unique(),
  title: text('title').notNull(),
  authors: text('authors'),
  schoolId: uuid('school_id').references(() => schools.id),
  courseId: uuid('course_id').references(() => courses.id),
  year: text('year'),
  researchType: text('research_type'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

/**
 * File rows reference the single authoritative R2 object key.
 * Do not copy the file (or its key) merely to represent a status change.
 */
export const submissionFiles = pgTable('submission_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

/**
 * Authoritative accept/reject record. Remarks are NOT NULL: REO must enter
 * remarks before either decision (Architecture v1 §3). Reading email never
 * writes here; only an authorized repository manager's action does.
 */
export const decisions = pgTable('decisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  submissionId: uuid('submission_id')
    .notNull()
    .unique()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  reviewerId: uuid('reviewer_id')
    .notNull()
    .references(() => profiles.id),
  status: submissionStatus('status').notNull(),
  remarks: text('remarks').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  submitter: one(profiles, {
    fields: [submissions.submitterId],
    references: [profiles.id],
  }),
  files: many(submissionFiles),
  decision: one(decisions, {
    fields: [submissions.id],
    references: [decisions.submissionId],
  }),
}))

export const submissionFilesRelations = relations(
  submissionFiles,
  ({ one }) => ({
    submission: one(submissions, {
      fields: [submissionFiles.submissionId],
      references: [submissions.id],
    }),
  }),
)

export const decisionsRelations = relations(decisions, ({ one }) => ({
  submission: one(submissions, {
    fields: [decisions.submissionId],
    references: [submissions.id],
  }),
  reviewer: one(profiles, {
    fields: [decisions.reviewerId],
    references: [profiles.id],
  }),
}))
