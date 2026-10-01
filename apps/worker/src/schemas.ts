import { z } from 'zod'

export const initiateUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
})

export const createSubmissionSchema = z.object({
  key: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
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
