import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { researchRecords } from './repository'

export const extractionStatus = pgEnum('extraction_status', [
  'QUEUED',
  'PROCESSING',
  'EXTRACTED',
  'FAILED',
])

/** Durable extraction queue; created in the same statement as acceptance.
 * Results are restricted operational data, not indexed/searchable evidence.
 */
export const processingJobs = pgTable('processing_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  recordId: uuid('record_id')
    .notNull()
    .unique()
    .references(() => researchRecords.id, { onDelete: 'cascade' }),
  status: extractionStatus('status').notNull().default('QUEUED'),
  attempts: integer('attempts').notNull().default(0),
  claimToken: uuid('claim_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  errorCode: text('error_code'),
  result: jsonb('result'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
