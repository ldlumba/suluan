import { z } from 'zod'

/**
 * Text fields of the multipart submission form. The file itself arrives
 * as a File part and is validated separately (validateUploadFile), since
 * Zod cannot validate Blobs as cleanly. Empty strings from FormData mean
 * "no selection" and are normalized to undefined by the route.
 */
export const submissionFormFieldsSchema = z.object({
  idempotencyKey: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((title) => /[\p{L}\p{N}]/u.test(title.normalize('NFKC'))),
  authors: z.string().trim().max(2000).optional(),
  schoolId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  duplicateAcknowledged: z.literal('true').optional(),
})

export const decideSchema = z
  .object({
    submissionId: z.string().uuid(),
    status: z.enum(['ACCEPTED', 'REJECTED']),
    remarks: z
      .string()
      .trim()
      .min(1, 'Remarks are required before a decision.')
      .max(10000),
    /** Only meaningful when accepting; ignored on rejection. */
    visibility: z.enum(['PUBLIC', 'UA_ONLY', 'RESTRICTED']).optional(),
    /** Optional auto-lift date (YYYY-MM-DD), must be in the future. */
    embargoUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
      .optional(),
  })
  // Approved policy: an embargo date on a PUBLIC record is a no-op (the
  // record is already public), not an error. recordDecisionAtomic normalizes
  // it to NULL so no misleading date is stored. Only a past date is rejected.
  .refine(
    (value) =>
      value.embargoUntil === undefined ||
      (value.status === 'REJECTED' ? true : value.embargoUntil > todayUtc()),
    {
      message: 'The embargo date must be in the future.',
      path: ['embargoUntil'],
    },
  )

/** UTC date string; the API compares against Postgres current_date. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}
