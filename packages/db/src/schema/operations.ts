import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { profiles } from './identity'

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
