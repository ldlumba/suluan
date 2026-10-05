import {
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { submissions } from './intake'
import { researchRecords } from './repository'

/**
 * Author keywords v1 (Architecture v1 §12, 2026-10-05): free-text terms, up
 * to 5 per submission; no controlled vocabulary, no ranking use. Intake terms
 * are preserved verbatim (including for rejected submissions, which stay in
 * the REO-only archive). Repository terms are deduplicated by normalized
 * name so analytics and future graph nodes share one concept row.
 * Normalization is deliberately dumb — lowercase, trim, collapse
 * whitespace. Synonyms are NOT merged ("AI" != "Artificial Intelligence").
 * System-derived topics, when they arrive, get their own table; they must
 * never be written here.
 */
export const submissionKeywords = pgTable(
  'submission_keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    /** Verbatim author term, trimmed. */
    term: text('term').notNull(),
    /** Lowercased, trimmed, whitespace-collapsed. Computed once, app-side. */
    normalizedName: text('normalized_name').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique('submission_keywords_submission_normalized').on(t.submissionId, t.normalizedName)],
)

/** One row per normalized concept. Append-only: never delete these rows. */
export const keywords = pgTable(
  'keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    normalizedName: text('normalized_name').notNull().unique(),
    /** First-seen original casing, for display. */
    displayName: text('display_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
)

/** Repository links. Position preserves author order. */
export const researchKeywords = pgTable(
  'research_keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => researchRecords.id, { onDelete: 'cascade' }),
    keywordId: uuid('keyword_id')
      .notNull()
      .references(() => keywords.id),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique('research_keywords_record_keyword').on(t.recordId, t.keywordId)],
)

export const submissionKeywordsRelations = relations(
  submissionKeywords,
  ({ one }) => ({
    submission: one(submissions, {
      fields: [submissionKeywords.submissionId],
      references: [submissions.id],
    }),
  }),
)

export const keywordsRelations = relations(keywords, ({ many }) => ({
  researchKeywords: many(researchKeywords),
}))

export const researchKeywordsRelations = relations(
  researchKeywords,
  ({ one }) => ({
    record: one(researchRecords, {
      fields: [researchKeywords.recordId],
      references: [researchRecords.id],
    }),
    keyword: one(keywords, {
      fields: [researchKeywords.keywordId],
      references: [keywords.id],
    }),
  }),
)
