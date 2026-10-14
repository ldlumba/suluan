import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { courses, researchRecords, schools } from '@suluan/db/schema'
import { buildNeighborhood } from '../src/graph'
import {
  deleteAuditEvents,
  deleteProfiles,
  deleteSubmissions,
  insertProfile,
  setupTestAuth,
  testDb,
  type TestAuth,
} from './helpers'

const center = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Center paper',
  year: 2026,
  course_id: '22222222-2222-4222-8222-222222222222',
  course_name: 'BS Information Technology',
  school_id: '33333333-3333-4333-8333-333333333333',
  school_name: 'School of Technology',
  authors: [{ name: 'Jane Doe', normalizedName: 'jane doe' }],
  keywords: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      label: 'Machine Learning',
      normalizedName: 'machine learning',
    },
  ],
  shared_keywords: 1,
  shared_authors: 1,
  shared_course: 1,
}

describe('knowledge graph neighborhood', () => {
  it('builds typed metadata and derived related-paper edges', () => {
    const related = {
      ...center,
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Related paper',
      authors: [{ name: 'John Doe', normalizedName: 'john doe' }],
    }
    const graph = buildNeighborhood([center, related], center.id)

    expect(graph.nodes.filter((node) => node.type === 'paper')).toHaveLength(2)
    expect(graph.nodes.filter((node) => node.type === 'keyword')).toHaveLength(
      1,
    )
    expect(graph.nodes.filter((node) => node.type === 'author')).toHaveLength(1)
    expect(graph.nodes.filter((node) => node.type === 'year')).toHaveLength(1)
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: 'SHARES_KEYWORD_WITH',
        weight: 1,
      }),
    )
    expect(graph.nodes.find((node) => node.center)?.recordId).toBe(center.id)
  })

  it('enforces metadata node caps and omits dangling edges', () => {
    const manyKeywords = Array.from({ length: 35 }, (_, index) => ({
      id: `${String(index).padStart(8, '0')}-4444-4444-8444-444444444444`,
      label: `Keyword ${index}`,
      normalizedName: `keyword ${index}`,
    }))
    const graph = buildNeighborhood(
      [{ ...center, keywords: manyKeywords }],
      center.id,
    )

    expect(graph.nodes.filter((node) => node.type === 'keyword')).toHaveLength(
      30,
    )
    expect(
      graph.edges.filter((edge) => edge.type === 'TAGGED_WITH'),
    ).toHaveLength(30)
    expect(graph.truncated).toBe(true)
    expect(
      graph.edges.every(
        (edge) =>
          graph.nodes.some((node) => node.id === edge.source) &&
          graph.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true)
  })
})

const needsDb = process.env.DATABASE_URL ? describe : describe.skip

needsDb('viewer-safe graph route', () => {
  let auth: TestAuth
  let managerToken: string
  let userToken: string
  let schoolId: string
  let courseId: string
  const submissionIds: string[] = []
  const recordIds: string[] = []
  const tag = crypto.randomUUID().replaceAll('-', '')
  const managerUid = `test-graph-manager-${tag}`
  const userUid = `test-graph-user-${tag}`

  beforeAll(async () => {
    auth = await setupTestAuth()
    await insertProfile(
      testDb(),
      managerUid,
      `${managerUid}@ua.edu.ph`,
      'REPOSITORY_MANAGER',
    )
    managerToken = await auth.mintToken({
      sub: managerUid,
      email: `${managerUid}@ua.edu.ph`,
    })
    userToken = await auth.mintToken({
      sub: userUid,
      email: `${userUid}@ua.edu.ph`,
    })
    const [catalog] = await testDb()
      .select({ schoolId: schools.id, courseId: courses.id })
      .from(courses)
      .innerJoin(schools, eq(schools.id, courses.schoolId))
      .where(eq(courses.active, true))
      .orderBy(courses.createdAt, courses.id)
      .limit(1)
    ;({ schoolId, courseId } = catalog)
  })

  afterAll(async () => {
    await deleteAuditEvents(testDb(), recordIds, [managerUid, userUid])
    await deleteSubmissions(testDb(), submissionIds)
    await deleteAuditEvents(testDb(), submissionIds, [managerUid, userUid])
    await deleteProfiles(testDb(), [managerUid, userUid])
  })

  async function fixture(title: string, visibility: 'PUBLIC' | 'RESTRICTED') {
    const form = new FormData()
    form.append(
      'file',
      new File(['graph test'], 'paper.pdf', { type: 'application/pdf' }),
    )
    form.append('title', title)
    form.append('authors', `Shared Author ${tag}`)
    form.append('schoolId', schoolId)
    form.append('courseId', courseId)
    form.append('idempotencyKey', crypto.randomUUID())
    form.append('keywords[]', `Shared Topic ${tag}`)
    form.append('keywords[]', `Second Topic ${tag}`)
    const submitted = await auth.app.request(
      '/api/submissions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${managerToken}` },
        body: form,
      },
      auth.testEnv(),
    )
    const submission = (await submitted.json()) as { id: string }
    submissionIds.push(submission.id)
    const decided = await auth.app.request(
      '/api/decisions',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${managerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          submissionId: submission.id,
          status: 'ACCEPTED',
          remarks: 'Graph visibility fixture',
          visibility,
        }),
      },
      auth.testEnv(),
    )
    expect(decided.status).toBe(201)
    const [record] = await testDb()
      .select({ id: researchRecords.id })
      .from(researchRecords)
      .where(eq(researchRecords.submissionId, submission.id))
    recordIds.push(record.id)
    return record.id
  }

  it('reapplies visibility to the center and every related-paper hop', async () => {
    const center = await fixture(`Center ${tag}`, 'PUBLIC')
    const publicRelated = await fixture(`Public related ${tag}`, 'PUBLIC')
    const restrictedRelated = await fixture(
      `Restricted related ${tag}`,
      'RESTRICTED',
    )
    const path = `/api/graph/neighborhood?type=paper&id=${center}&depth=2`

    const anonymous = await auth.authed(path, null)
    expect(anonymous.status).toBe(200)
    expect(anonymous.headers.get('cache-control')).toBe('public, max-age=30')
    expect(anonymous.headers.get('vary')).toContain('Authorization')
    const anonymousBody = (await anonymous.json()) as {
      nodes: { type: string; recordId?: string }[]
    }
    const anonymousPapers = anonymousBody.nodes
      .filter((node) => node.type === 'paper')
      .map((node) => node.recordId)
    expect(anonymousPapers).toContain(center)
    expect(anonymousPapers).toContain(publicRelated)
    expect(anonymousPapers).not.toContain(restrictedRelated)

    const user = await auth.authed(path, userToken)
    expect(user.status).toBe(200)
    expect(user.headers.get('cache-control')).toBe('private, no-store')
    expect(user.headers.get('vary')).toContain('Authorization')
    const userBody = (await user.json()) as typeof anonymousBody
    expect(
      userBody.nodes.some((node) => node.recordId === restrictedRelated),
    ).toBe(false)

    const manager = await auth.authed(path, managerToken)
    const managerBody = (await manager.json()) as typeof anonymousBody
    expect(
      managerBody.nodes.some((node) => node.recordId === restrictedRelated),
    ).toBe(true)

    const hiddenCenter = await auth.authed(
      `/api/graph/neighborhood?type=paper&id=${restrictedRelated}&depth=2`,
      null,
    )
    expect(hiddenCenter.status).toBe(404)

    const anonymousCounts = await auth.authed(
      '/api/graph/counts?groupBy=keyword',
      null,
    )
    const managerCounts = await auth.authed(
      '/api/graph/counts?groupBy=keyword',
      managerToken,
    )
    expect(anonymousCounts.headers.get('cache-control')).toBe(
      'public, max-age=30',
    )
    expect(managerCounts.headers.get('cache-control')).toBe('private, no-store')
    const anonymousAggregate = (await anonymousCounts.json()) as {
      items: { label: string; count: number }[]
      pairs: { firstLabel: string; secondLabel: string; count: number }[]
    }
    const managerAggregate =
      (await managerCounts.json()) as typeof anonymousAggregate
    expect(
      anonymousAggregate.items.find((item) =>
        item.label.startsWith('Shared Topic'),
      )?.count,
    ).toBe(2)
    expect(
      managerAggregate.items.find((item) =>
        item.label.startsWith('Shared Topic'),
      )?.count,
    ).toBe(3)
    const isFixturePair = (pair: { firstLabel: string; secondLabel: string }) =>
      pair.firstLabel.includes(tag) && pair.secondLabel.includes(tag)
    expect(anonymousAggregate.pairs.find(isFixturePair)?.count).toBe(2)
    expect(managerAggregate.pairs.find(isFixturePair)?.count).toBe(3)
  }, 60_000)
})
