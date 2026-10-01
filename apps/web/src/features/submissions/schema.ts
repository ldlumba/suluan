import { z } from 'zod'

/** Mirrors the Worker upload policy (Architecture v1 §12, 2026-10-01). */
export const MAX_FILE_BYTES = 30 * 1024 * 1024

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

const EXTENSION_FOR_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
}

const fileSchema = z
  .custom<File>((v) => v instanceof File, 'A PDF or DOCX document is required.')
  .refine(
    (f) => (ACCEPTED_TYPES as readonly string[]).includes(f.type),
    'Only PDF or DOCX documents are accepted.',
  )
  .refine((f) => f.size > 0, 'The selected file is empty.')
  .refine(
    (f) => f.size <= MAX_FILE_BYTES,
    'The file exceeds the 30 MB limit.',
  )
  .refine((f) => {
    const expected = EXTENSION_FOR_TYPE[f.type]
    return expected !== undefined && f.name.split('.').pop()?.toLowerCase() === expected
  }, 'The file name does not match its document type.')

export const submissionFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(500),
  authors: z.string().trim().max(2000).optional(),
  // Empty string = "no selection"; mapped to undefined before sending.
  schoolId: z.string().optional(),
  courseId: z.string().optional(),
  year: z.string().trim().max(9).optional(),
  researchType: z.string().trim().max(100).optional(),
  file: fileSchema,
})

export type SubmissionFormValues = z.infer<typeof submissionFormSchema>
