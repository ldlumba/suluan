import { sql } from 'drizzle-orm'
import {
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { researchRecords } from './repository'
import { profiles } from './identity'

/**
 * Embedding geometry (owner-approved 2026-10-01). 768 dims was the approved
 * figure and stays the stored width: gemini-embedding-001 scores 67.99 on MTEB
 * multilingual at 768 vs 68.32 at 3072, so truncation costs ~0.3 points while
 * keeping a quarter of the storage. Changing this value requires re-embedding
 * every chunk — the spaces of different widths are not comparable.
 */
export const EMBEDDING_DIMS = 768

/**
 * Model identifier stored per snapshot so a model change re-embeds rather than
 * silently mixing incomparable vectors in one index. The originally locked
 * text-embedding-004 was removed from the Gemini API (deprecated 2026-01-14);
 * gemini-embedding-001 is the GA text-only replacement and the only GA option
 * that still supports task_type.
 */
export const EMBEDDING_MODEL = 'gemini-embedding-001'

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

/**
 * Semantic snapshots. One row per (keyword snapshot x model x width), so a new
 * extraction claim, a new chunker version, or a model change each produce a
 * distinct snapshot instead of overwriting vectors that are no longer
 * comparable. Existence of a row is NOT an `INDEXED` status: it means the
 * vectors for that exact snapshot were stored.
 */
export const semanticIndexes = pgTable(
  'semantic_indexes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Parent keyword snapshot; same chunk text, same chunker version. */
    keywordIndexId: uuid('keyword_index_id')
      .notNull()
      .references(() => keywordIndexes.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    createdBy: uuid('created_by').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique().on(table.keywordIndexId, table.model, table.dimensions),
  ],
)

/**
 * One normalized vector per chunk. The UNIQUE on chunk_id is the embed-once
 * guarantee at the storage layer: a retried or concurrent preparation cannot
 * produce a second vector for the same text.
 *
 * Deliberately NO HNSW/IVFFlat index yet. The repository is a small academic
 * corpus, where an approximate index costs recall for no measurable latency
 * win; exact scan is also what we want for verification. Revisit with real
 * row counts, not guesses.
 */
export const documentEmbeddings = pgTable(
  'document_embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    semanticIndexId: uuid('semantic_index_id')
      .notNull()
      .references(() => semanticIndexes.id, { onDelete: 'cascade' }),
    chunkId: uuid('chunk_id')
      .notNull()
      .unique()
      .references(() => documentChunks.id, { onDelete: 'cascade' }),
    /** L2-normalized, so cosine distance is a plain inner product. */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMS }).notNull(),
  },
  (table) => [
    index('document_embeddings_semantic_index_idx').on(table.semanticIndexId),
  ],
)

/**
 * Server-side embedding quota counters (owner-approved 2026-10-01).
 *
 * Counters are bucketed by purpose and actor and reset on a UTC day, matching
 * the API's daily limits. Quotas MUST be enforced here, before any paid call.
 *
 * `actor_key` holds a profile id or the literal 'all'. It deliberately does NOT
 * hold an IP address: per-IP anonymous counters are deferred until anonymous
 * semantic search is actually launched, because storing IPs is personal data
 * under the Data Privacy Act and needs a retention policy and privacy notice
 * that do not exist yet. The global bucket still bounds anonymous traffic in
 * the meantime, and exhausted quota fails closed to keyword search.
 */
export const embeddingUsage = pgTable(
  'embedding_usage',
  {
    bucket: text('bucket').notNull(),
    actorKey: text('actor_key').notNull(),
    day: date('day').notNull(),
    requests: integer('requests').notNull().default(0),
    inputs: integer('inputs').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.actorKey, table.day] })],
)
