import { describe, expect, it } from 'vitest'
import { submissionFormSchema } from './schema'

function pdf(name = 'paper.pdf', size = 1024): File {
  return new File(['x'.repeat(size)], name, { type: 'application/pdf' })
}

function docx(name = 'paper.docx', size = 1024): File {
  return new File(['x'.repeat(size)], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

const base = {
  title: 'A study of something',
  authors: 'Doe, J.',
  schoolId: '',
  courseId: '',
}

describe('submission form schema', () => {
  it('accepts a valid PDF submission', () => {
    expect(
      submissionFormSchema.safeParse({ ...base, file: pdf() }).success,
    ).toBe(true)
  })

  it('rejects DOCX in the PDF-only submission form', () => {
    expect(
      submissionFormSchema.safeParse({ ...base, file: docx() }).success,
    ).toBe(false)
  })

  it('rejects missing titles', () => {
    const result = submissionFormSchema.safeParse({
      ...base,
      title: '  ',
      file: pdf(),
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-PDF types', () => {
    const txt = new File(['hi'], 'notes.txt', { type: 'text/plain' })
    const result = submissionFormSchema.safeParse({ ...base, file: txt })
    expect(result.success).toBe(false)
  })

  it('rejects mismatched file names', () => {
    const renamed = new File(['x'], 'paper.pdf', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const result = submissionFormSchema.safeParse({ ...base, file: renamed })
    expect(result.success).toBe(false)
  })

  it('rejects oversized files', () => {
    const result = submissionFormSchema.safeParse({
      ...base,
      file: pdf('big.pdf', 15 * 1024 * 1024 + 1),
    })
    expect(result.success).toBe(false)
  })

  it('accepts a PDF at the 15 MiB limit', () => {
    expect(
      submissionFormSchema.safeParse({
        ...base,
        file: pdf('limit.pdf', 15 * 1024 * 1024),
      }).success,
    ).toBe(true)
  })

  it('rejects missing files', () => {
    const result = submissionFormSchema.safeParse({ ...base, file: undefined })
    expect(result.success).toBe(false)
  })
})
