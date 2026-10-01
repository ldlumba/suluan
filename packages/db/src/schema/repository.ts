import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { submissions } from './intake'

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
