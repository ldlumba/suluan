import { pgEnum, pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core'
import { profiles } from './identity'
import { researchRecords } from './repository'

export const activityEventType = pgEnum('activity_event_type', [
  'PAPER_VIEW',
  'CITATION_COPY',
  'DOWNLOAD_START',
])

/** Minimal authenticated activity telemetry; no IP, email, title, or content. */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => researchRecords.id, { onDelete: 'cascade' }),
    eventType: activityEventType('event_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('activity_events_created_at_idx').on(table.createdAt),
    index('activity_events_record_type_idx').on(
      table.recordId,
      table.eventType,
      table.createdAt,
    ),
    index('activity_events_profile_record_type_idx').on(
      table.profileId,
      table.recordId,
      table.eventType,
      table.createdAt,
    ),
  ],
)
