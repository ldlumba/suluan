import { describe, expect, it } from 'vitest'
import { submissionFormFieldsSchema } from '../src/schemas'

describe('submission catalog validation', () => {
  const fields = {
    idempotencyKey: '10000000-0000-4000-8000-000000000001',
    title: 'A paper',
    schoolId: '10000000-0000-4000-8000-000000000002',
    courseId: '10000000-0000-4000-8000-000000000003',
  }
  it('requires both catalog selections', () => {
    expect(submissionFormFieldsSchema.safeParse(fields).success).toBe(true)
    expect(
      submissionFormFieldsSchema.safeParse({ ...fields, schoolId: undefined })
        .success,
    ).toBe(false)
    expect(
      submissionFormFieldsSchema.safeParse({ ...fields, courseId: undefined })
        .success,
    ).toBe(false)
  })
})
