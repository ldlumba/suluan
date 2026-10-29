import { timestamp, uniqueIndex, uuid, pgTable } from 'drizzle-orm/pg-core'
import { profiles } from './identity'
import { researchRecords } from './repository'

/** Private per-user saved-paper list. It never changes repository visibility. */
export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => researchRecords.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('bookmarks_profile_record_unique').on(
      table.profileId,
      table.recordId,
    ),
  ],
)
