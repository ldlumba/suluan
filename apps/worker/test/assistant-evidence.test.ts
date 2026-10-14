import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { CHUNKER_VERSION } from '../src/chunking'
import { retrieveAssistantEvidence } from '../src/assistant'
import { evidenceStillPublic } from '../src/assistant-routes'
import {
  deleteProfiles,
  deleteSubmissions,
  insertProfile,
  testDb,
} from './helpers'

const needsDb = process.env.DATABASE_URL ? describe : describe.skip
needsDb('assistant evidence eligibility', () => {
  const uid = `assistant-evidence-${crypto.randomUUID()}`
  const vector = Array.from({ length: 768 }, (_, i) => (i === 767 ? 1 : 0))
  const submissionIds: string[] = []
  const records: Record<string, string> = {}
  beforeAll(async () => {
    const db = testDb(),
      actor = await insertProfile(db, uid, `${uid}@ua.edu.ph`, 'ADMIN')
    // Deliberately construct impossible pending/rejected derivatives to prove
    // the retrieval predicate still fails closed if upstream invariants fail.
    for (const kind of [
      'public',
      'ua',
      'restricted',
      'pending',
      'rejected',
      'partial',
      'stale',
      'embargoed',
      'lifted',
    ]) {
      const submission = crypto.randomUUID(),
        record = crypto.randomUUID(),
        claim = crypto.randomUUID()
      const keyword = crypto.randomUUID(),
        semantic = crypto.randomUUID(),
        chunk = crypto.randomUUID()
      submissionIds.push(submission)
      records[kind] = record
      const status =
        kind === 'pending'
          ? 'PENDING'
          : kind === 'rejected'
            ? 'REJECTED'
            : 'ACCEPTED'
      const visibility =
        kind === 'ua'
          ? 'UA_ONLY'
          : ['restricted', 'embargoed', 'lifted'].includes(kind)
            ? 'RESTRICTED'
            : 'PUBLIC'
      const embargo =
        kind === 'embargoed'
          ? '2099-01-01'
          : kind === 'lifted'
            ? '2000-01-01'
            : null
      await db.execute(sql`with s as (
        insert into submissions(id, submitter_id, status, idempotency_key, title, normalized_title)
        values (${submission}, ${actor.id}, ${status}::submission_status, ${submission}, ${`${uid}-${kind}`}, ${`${uid}-${kind}`}) returning id
      ), r as (
        insert into research_records(id, submission_id, title, year, visibility, embargo_until)
        select ${record}, id, ${`${uid}-${kind}`}, 2026, ${visibility}::record_visibility, ${embargo}::date from s returning id
      ), j as (
        insert into processing_jobs(record_id, status, claim_token)
        select id, 'EXTRACTED', ${kind === 'stale' ? crypto.randomUUID() : claim} from r
      ), k as (
        insert into keyword_indexes(id, record_id, extraction_claim_token, chunker_version, source_sha256)
        select ${keyword}, id, ${claim}, ${CHUNKER_VERSION}, ${'a'.repeat(64)} from r returning id
      ), si as (
        insert into semantic_indexes(id, keyword_index_id, model, dimensions, chunker_version, source_sha256)
        select ${semantic}, id, 'gemini-embedding-001', 768, ${CHUNKER_VERSION}, ${'a'.repeat(64)} from k returning id
      ), d as (
        insert into document_chunks(id, index_id, ordinal, start_offset, end_offset, content)
        select ${chunk}, id, 0, 0, 24, 'Synthetic study evidence' from k returning id
      ) insert into document_embeddings(chunk_id, semantic_index_id, embedding)
        select d.id, si.id, cast(${JSON.stringify(vector)} as vector) from d, si`)
      if (kind === 'partial')
        await db.execute(sql`insert into document_chunks(index_id, ordinal, start_offset, end_offset, content)
        values (${keyword}, 1, 24, 38, 'Missing vector')`)
    }
    await db.execute(sql`insert into record_authors(record_id, name, position) values
      (${records.public}, 'Second, Bea', 1), (${records.public}, 'First, Ana', 0),
      (${records.restricted}, 'Private author', 0)`)
  }, 30_000)
  afterAll(async () => {
    await deleteSubmissions(testDb(), submissionIds)
    await deleteProfiles(testDb(), [uid])
  })
  it('allows only current, complete effective-PUBLIC evidence even for managers', async () => {
    const evidence = await retrieveAssistantEvidence(
      testDb(),
      'MANAGER',
      vector,
      { limit: 5 },
    )
    const own = evidence.filter((e) =>
      Object.values(records).includes(e.recordId),
    )
    expect(own.map((e) => e.recordId).sort()).toEqual(
      [records.public, records.lifted].sort(),
    )
    expect(own.find((e) => e.recordId === records.public)?.authors).toEqual([
      'First, Ana',
      'Second, Bea',
    ])
    expect(own.find((e) => e.recordId === records.lifted)?.authors).toEqual([])
    expect(evidence.flatMap((e) => e.authors)).not.toContain('Private author')
    expect(
      await retrieveAssistantEvidence(testDb(), 'PUBLIC', vector, { limit: 5 }),
    ).toEqual([])
    expect(await evidenceStillPublic(testDb(), own)).toBe(true)
    await testDb().execute(
      sql`update research_records set visibility = 'RESTRICTED' where id = ${records.public}`,
    )
    expect(await evidenceStillPublic(testDb(), own)).toBe(false)
  })
})
