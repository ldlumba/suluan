import { z } from 'zod'

/** Browser form limit; the Worker independently applies its upload policy. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024

const ACCEPTED_TYPES = ['application/pdf'] as const

const EXTENSION_FOR_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
}

const fileSchema = z
  .custom<File>((v) => v instanceof File, 'A PDF document is required.')
  .refine(
    (f) => (ACCEPTED_TYPES as readonly string[]).includes(f.type),
    'Only PDF documents are accepted.',
  )
  .refine((f) => f.size > 0, 'The selected file is empty.')
  .refine((f) => f.size <= MAX_FILE_BYTES, 'The file exceeds the 15 MB limit.')
  .refine((f) => {
    const expected = EXTENSION_FOR_TYPE[f.type]
    return (
      expected !== undefined &&
      f.name.split('.').pop()?.toLowerCase() === expected
    )
  }, 'The file name does not match its document type.')

export const submissionFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(500)
    .refine(
      (title) => /[\p{L}\p{N}]/u.test(title.normalize('NFKC')),
      'Title must include a letter or number.',
    ),
  authors: z.string().trim().max(2000).optional(),
  schoolId: z.string().min(1, 'Select a school.'),
  courseId: z.string().min(1, 'Select a program.'),
  // Author keywords v1: free text, up to 5. The chip input trims and
  // dedupes client-side; the Worker re-validates authoritatively.
  keywords: z
    .array(z.string().trim().min(1).max(100))
    .max(5, 'Use at most 5 keywords.')
    .default([]),
  file: fileSchema,
})

export type SubmissionFormValues = z.output<typeof submissionFormSchema>
export type SubmissionFormInput = z.input<typeof submissionFormSchema>
