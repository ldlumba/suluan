import {
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { profiles } from './identity'

// Operational metadata only. Never store prompts, answers, or evidence bodies.
export const assistantSessions = pgTable('assistant_sessions', {
  id: uuid('id').primaryKey(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  turns: integer('turns').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const assistantUsage = pgTable(
  'assistant_usage',
  {
    actorKey: text('actor_key').notNull(),
    day: date('day').notNull(),
    requests: integer('requests').notNull().default(0),
    lastStartedAt: timestamp('last_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.actorKey, table.day] })],
)

export const assistantRequests = pgTable('assistant_requests', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => assistantSessions.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('reserved'),
  embedTicket: uuid('embed_ticket').notNull().unique(),
  generateTicket: uuid('generate_ticket').notNull().unique(),
  embedHash: text('embed_hash'),
  generateHash: text('generate_hash'),
  embedUsedAt: timestamp('embed_used_at', { withTimezone: true }),
  generateUsedAt: timestamp('generate_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})
