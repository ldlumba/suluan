import {
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { submissions } from './intake'

/**
 * Per-record visibility (owner-approved 2026-10-01). PUBLIC is the default so
 * an accepted paper is discoverable; UA_ONLY requires a signed-in UA account
 * for text/downloads; RESTRICTED is manager-only everywhere. Rejected
 * submissions never get a record row at all, so no value here can expose them.
 */
export const recordVisibility = pgEnum('record_visibility', [
  'PUBLIC',
  'UA_ONLY',
  'RESTRICTED',
])

/**
 * Published repository domain — SEPARATE from intake. A record exists only
 * via acceptance of a submission (submission_id is the bridge, one-to-one).
 * Rejected submissions never get rows here; they stay in the REO-only
 * intake archive. Extraction state lives in processing_jobs; search indexing
 * is a later stage and is not implied by successful extraction.
 */
export const researchRecords = pgTable('research_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  submissionId: uuid('submission_id')
    .notNull()
    .unique()
    .references(() => submissions.id),
  title: text('title').notNull(),
  abstract: text('abstract'),
  /** Managers set this at review time; PUBLIC is the default. */
  visibility: recordVisibility('visibility').notNull().default('PUBLIC'),
  /**
   * Optional auto-lift date for time-bound restrictions (journal embargo,
   * patent, funder agreement). Null means the restriction is indefinite.
   * The date only applies to UA_ONLY/RESTRICTED; PUBLIC is already public.
   */
  embargoUntil: date('embargo_until'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

/**
 * Points at the SAME R2 object accepted at intake — not a copy.
 */
export const recordFiles = pgTable('record_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id')
    .notNull()
    .references(() => researchRecords.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export const recordAuthors = pgTable('record_authors', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id')
    .notNull()
    .references(() => researchRecords.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
})
