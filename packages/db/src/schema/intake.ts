import {
  bigint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
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
