import { z } from 'zod'

/**
 * Text fields of the multipart submission form. The file itself arrives
 * as a File part and is validated separately (validateUploadFile), since
 * Zod cannot validate Blobs as cleanly. Empty strings from FormData mean
 * "no selection" and are normalized to undefined by the route.
 */
export const submissionFormFieldsSchema = z.object({
  idempotencyKey: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  authors: z.string().trim().max(2000).optional(),
  schoolId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  year: z.string().trim().max(9).optional(),
  researchType: z.string().trim().max(100).optional(),
})

export const decideSchema = z.object({
  submissionId: z.string().uuid(),
  status: z.enum(['ACCEPTED', 'REJECTED']),
  remarks: z
    .string()
    .trim()
    .min(1, 'Remarks are required before a decision.')
    .max(10000),
})
