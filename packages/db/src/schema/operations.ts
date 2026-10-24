import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
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

export const repositoryOperationAction = pgEnum('repository_operation_action', [
  'EXTRACTION',
  'EMBEDDING',
])

export const repositoryOperationStatus = pgEnum('repository_operation_status', [
  'REQUESTED',
  'DISPATCHING',
  'LAUNCHED',
  'FAILED',
])

/**
 * Audited, single-use handoff from a manager-authorized Worker request to the
 * public-ticket Cloud Run dispatcher. The dispatcher has no repository data
 * access; it can start only the two bounded production Jobs granted by IAM.
 */
export const repositoryOperationRuns = pgTable(
  'repository_operation_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => profiles.id),
    action: repositoryOperationAction('action').notNull(),
    status: repositoryOperationStatus('status').notNull().default('REQUESTED'),
    ticketHash: text('ticket_hash').notNull().unique(),
    executionName: text('execution_name'),
    errorCode: text('error_code'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('repository_operation_runs_active_action_unique')
      .on(table.action)
      .where(
        sql`${table.status} in ('REQUESTED'::repository_operation_status, 'DISPATCHING'::repository_operation_status)`,
      ),
  ],
)

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
