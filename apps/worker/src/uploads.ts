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

/**
 * Infer a MIME type from the file extension when the browser sends an
 * empty content type (some OS/browser combos do for DOCX). Returns null
 * when the extension is not one we accept.
 */
export function inferMimeFromFileName(fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase()
  for (const [mime, mapped] of Object.entries(
    UPLOAD_POLICY.extensionForMime,
  )) {
    if (mapped === ext) return mime
  }
  return null
}

export type FileRejection =
  | 'missing_file'
  | 'empty_file'
  | 'unsupported_file_type'
  | 'filename_type_mismatch'
  | 'file_too_large'

export interface ValidatedUpload {
  fileName: string
  mimeType: string
  sizeBytes: number
}

/**
 * Single validation choke point for uploaded files, shared by the route
 * and unit-testable without HTTP. The effective MIME is the browser's
 * content type, falling back to extension inference when empty.
 */
export function validateUploadFile(file: File): ValidatedUpload | FileRejection {
  const fileName = file.name ?? ''
  if (!fileName) return 'missing_file'
  const mimeType = file.type || inferMimeFromFileName(fileName) || ''
  if (!mimeType || !UPLOAD_POLICY.allowedMimeTypes.includes(mimeType)) {
    return 'unsupported_file_type'
  }
  if (!extensionMatchesMime(fileName, mimeType)) {
    return 'filename_type_mismatch'
  }
  if (file.size <= 0) return 'empty_file'
  if (file.size > UPLOAD_POLICY.maxSizeBytes) return 'file_too_large'
  return { fileName, mimeType, sizeBytes: file.size }
}

/**
 * Build the manager-download file name from the submission title, keeping
 * the original extension so the OS still recognizes the type. Reserved
 * filename characters and control characters become underscores; the
 * result is truncated to leave room for the extension. Falls back to the
 * original file name when the title has no usable characters.
 */
export function buildDownloadFileName(
  title: string,
  originalFileName: string,
): string {
  const ext = originalFileName.split('.').pop()?.toLowerCase()
  const suffix = ext === 'pdf' || ext === 'docx' ? `.${ext}` : ''
  const cleaned = title
    .replace(/[\\/:"*?<>|%\p{C}]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  if (!cleaned) return originalFileName || 'document'
  return `${cleaned}${suffix}`
}
