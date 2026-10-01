/**
 * Development upload policy, recorded 2026-10-01 (Architecture v1 §12).
 * PDF/DOCX only, 30 MB maximum, private `suluan-dev` bucket, no automatic
 * rejected-file deletion. These are development defaults, not permanent
 * policy.
 */
export const UPLOAD_POLICY = {
  maxSizeBytes: 30 * 1024 * 1024,
  allowedMimeTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  extensionForMime: {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
  } as Record<string, string>,
  /** Server-owned key prefix. Client-supplied keys are never trusted. */
  keyPrefix: 'intake/',
  uploadUrlTtlSeconds: 15 * 60,
  downloadUrlTtlSeconds: 15 * 60,
}

/**
 * Build a server-owned R2 key. The filename is sanitized to a safe suffix;
 * the uuid segment makes keys unguessable and collision-free.
 */
export function buildIntakeKey(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'document'
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'document'
  return `${UPLOAD_POLICY.keyPrefix}${crypto.randomUUID()}/${safe}`
}

/** Extension must agree with the declared MIME type (first-line defense). */
export function extensionMatchesMime(
  fileName: string,
  mimeType: string,
): boolean {
  const expected = UPLOAD_POLICY.extensionForMime[mimeType]
  if (!expected) return false
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext === expected
}
