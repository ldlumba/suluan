import { sql } from 'drizzle-orm'
import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { researchRecords } from './repository'

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

/** Keyword-ready snapshots, NOT semantic INDEXED status or AI evidence. */
export const keywordIndexes = pgTable(
  'keyword_indexes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => researchRecords.id, { onDelete: 'cascade' }),
    extractionClaimToken: uuid('extraction_claim_token').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique().on(
      table.recordId,
      table.extractionClaimToken,
      table.chunkerVersion,
    ),
  ],
)

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    indexId: uuid('index_id')
      .notNull()
      .references(() => keywordIndexes.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    content: text('content').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, content)`,
    ),
  },
  (table) => [
    unique().on(table.indexId, table.ordinal),
    index('document_chunks_search_gin').using('gin', table.searchVector),
  ],
)
