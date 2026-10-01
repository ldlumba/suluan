import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { profiles } from './identity'
import { submissions } from './intake'

/**
 * Provenance/audit trail (Architecture v1 §5): actor, action, entity,
 * timestamp, and relevant context for submissions, decisions, metadata/file
 * changes, publication, and role changes. actorId is nullable so automated
 * jobs can record system-originated events.
 */
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id').references(() => profiles.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  context: jsonb('context'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})

/**
 * Transactional outbox: domain writes and their follow-up jobs commit
 * atomically. A queue consumer claims unprocessed rows (processed_at IS
 * NULL) using an expiring lease. Completion follows dispatch; abandoned
 * claims are recoverable. External delivery is at-least-once.
 */
export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  claimToken: uuid('claim_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
})

export const notificationStatus = pgEnum('notification_status', [
  'PENDING',
  'SENT',
  'SKIPPED',
  'FAILED',
])

/**
 * One row per notification attempt, tracked separately from processing
 * outcomes. SKIPPED covers "no recipient/sender configured yet" — never
 * silently dropped, always visible. The Gmail sender arrives later;
 * until then the log adapter records deliveries here.
 */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  submissionId: uuid('submission_id').references(() => submissions.id),
  recipientEmail: text('recipient_email'),
  kind: text('kind').notNull(),
  status: notificationStatus('status').notNull().default('PENDING'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
})
