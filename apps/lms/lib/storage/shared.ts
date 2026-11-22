/**
 * Supabase Storage helpers that are safe to import from both server and client code.
 *
 * Storage layout (kept identical to the previous S3 structure):
 * - courses/course-{id}/thumbnail-{id}-{filename}
 * - courses/course-{id}/preview-video-{id}-{filename}
 * - courses/course-{id}/lessons/lesson-{id}/video-{id}-{filename}
 * - courses/course-{id}/lessons/lesson-{id}/resources/resource-{id}-{filename}
 * - courses/course-{id}/certificate/template-{id}-{filename}
 * - courses/course-{id}/certificate/signature-{id}-{filename}
 * - courses/course-{id}/lessons/lesson-{id}/quiz/quiz-{id}-{filename}
 * - profile/user-{id}/avatar-{id}-{filename}
 */

export const PUBLIC_MEDIA_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_MEDIA_BUCKET || "public-media"
export const CERTIFICATES_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_CERTIFICATES_BUCKET || "certificates"

export type StorageFileType =
  | "video"
  | "thumbnail"
  | "document"
  | "avatar"
  | "certificate"
  | "quiz-image"
  | "certificate-template"
  | "signature"
  | "lesson"
  | "quiz"
  | "resource"

/**
 * Generate the storage path for a file (same structure as the previous S3 layout)
 */
export function getStoragePath(
  type: StorageFileType,
  userId: string,
  filename: string,
  additionalPath?: string,
  fileHash?: string,
  courseId?: string | number,
  lessonId?: string | number,
  resourceId?: string | number,
  fileId?: string | number
): string {
  const timestamp = Date.now()
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_")
  const hashPrefix = fileHash ? `${fileHash.substring(0, 8)}-` : ""
  const fileIdentifier = fileId ? `${fileId}` : timestamp

  switch (type) {
    case "video":
      if (courseId) {
        if (lessonId) {
          return `courses/course-${courseId}/lessons/lesson-${lessonId}/video-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
        }
        return `courses/course-${courseId}/preview-video-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      if (additionalPath) {
        if (additionalPath.includes("/lessons/") || additionalPath.includes("lesson-")) {
          const parts = additionalPath.split("/")
          const lessonPart = parts.find(p => p.startsWith("lesson-")) || parts[parts.length - 1]
          const coursePart = parts.find(p => p.startsWith("course-")) || parts[0]
          const courseIdFromPath = coursePart.replace("course-", "")
          const lessonIdFromPath = lessonPart.replace("lesson-", "")
          return `courses/course-${courseIdFromPath}/lessons/lesson-${lessonIdFromPath}/video-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
        }
        return `courses/course-${additionalPath}/preview-video-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/videos/video-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`

    case "thumbnail":
      if (courseId) {
        return `courses/course-${courseId}/thumbnail-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      if (additionalPath) {
        return `courses/course-${additionalPath}/thumbnail-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/thumbnail-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`

    case "document":
    case "resource": {
      const resourcePrefix = resourceId ? `resource-${resourceId}` : `resource-${fileIdentifier}`
      if (courseId) {
        if (lessonId) {
          return `courses/course-${courseId}/lessons/lesson-${lessonId}/resources/${resourcePrefix}-${hashPrefix}${sanitizedFilename}`
        }
        return `courses/course-${courseId}/resources/${resourcePrefix}-${hashPrefix}${sanitizedFilename}`
      }
      if (type === "document" && additionalPath) {
        if (additionalPath.includes("/lessons/") || additionalPath.includes("lesson-")) {
          const parts = additionalPath.split("/")
          const lessonPart = parts.find(p => p.startsWith("lesson-")) || parts[parts.length - 1]
          const coursePart = parts.find(p => p.startsWith("course-")) || parts[0]
          const courseIdFromPath = coursePart.replace("course-", "")
          const lessonIdFromPath = lessonPart.replace("lesson-", "")
          return `courses/course-${courseIdFromPath}/lessons/lesson-${lessonIdFromPath}/resources/${resourcePrefix}-${hashPrefix}${sanitizedFilename}`
        }
        return `courses/course-${additionalPath}/resources/${resourcePrefix}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/resources/resource-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
    }

    case "quiz-image": {
      const quizPrefix = fileId ? `quiz-${fileId}` : `quiz-${fileIdentifier}`
      if (courseId) {
        return `courses/course-${courseId}/quiz-images/${quizPrefix}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/quiz-images/quiz-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
    }

    case "quiz": {
      const quizPrefix = fileId ? `quiz-${fileId}` : `quiz-${fileIdentifier}`
      if (courseId && lessonId) {
        return `courses/course-${courseId}/lessons/lesson-${lessonId}/quiz/${quizPrefix}-${hashPrefix}${sanitizedFilename}`
      }
      if (courseId) {
        return `courses/course-${courseId}/quiz-images/${quizPrefix}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/quiz-images/quiz-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
    }

    case "lesson":
      if (courseId && lessonId) {
        return `courses/course-${courseId}/lessons/lesson-${lessonId}/lesson-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      if (courseId) {
        return `courses/course-${courseId}/lessons/lesson-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/lessons/lesson-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`

    case "certificate-template":
      if (courseId) {
        return `courses/course-${courseId}/certificate/template-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/certificate/template-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`

    case "signature":
      if (courseId) {
        return `courses/course-${courseId}/certificate/signature-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
      }
      return `courses/temp-${userId}/certificate/signature-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`

    case "avatar":
      return `profile/user-${userId}/avatar-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`

    case "certificate": {
      const certPrefix = fileId ? `certificate-${fileId}` : `certificate-${fileIdentifier}`
      if (courseId) {
        return `courses/course-${courseId}/certificate/${certPrefix}-${hashPrefix}${sanitizedFilename}`
      }
      return `profile/user-${userId}/certificate-${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
    }

    default:
      return `uploads/temp-${userId}/${fileIdentifier}-${hashPrefix}${sanitizedFilename}`
  }
}

function encodeStoragePath(path: string): string {
  return path.split("/").map(segment => encodeURIComponent(segment)).join("/")
}

/**
 * Get the public URL for a file in a public bucket
 */
export function getPublicUrl(path: string, bucket: string = PUBLIC_MEDIA_BUCKET): string {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const cleanPath = path.startsWith("/") ? path.slice(1) : path
  return `${baseUrl}/storage/v1/object/public/${bucket}/${encodeStoragePath(cleanPath)}`
}

/**
 * Turn a stored URL back into its bucket and storage path.
 * Returns null for anything that is not in this project's Supabase Storage,
 * including site-relative paths (/brand/..., /courses/...) and external URLs.
 */
export function extractStoragePathFromUrl(url: string): { bucket: string; path: string } | null {
  if (!url) return null
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!supabaseUrl) return null
    const urlObj = new URL(url)
    if (urlObj.host !== new URL(supabaseUrl).host) return null
    const match = urlObj.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
    if (!match) return null
    const bucket = match[1]
    if (bucket !== PUBLIC_MEDIA_BUCKET && bucket !== CERTIFICATES_BUCKET) return null
    const path = match[2].split("/").map(segment => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    }).join("/")
    return { bucket, path }
  } catch {
    // Relative or invalid URL - not a Supabase Storage file
    return null
  }
}

/**
 * Videos are served directly from Supabase Storage as plain MP4.
 * These helpers are kept for compatibility and simply return the original value.
 */
export function transformToCDNUrl(url: string): string {
  return url
}

export function transformVideoUrls<T>(data: T): T {
  return data
}

export function getPreferredVideoUrl(url: string): string {
  return url
}

/**
 * Validate video file type
 */
export function isValidVideoFile(file: { name: string; type: string }): boolean {
  const validTypes = ["video/mp4", "video/webm", "video/ogg"]
  const validExtensions = ["mp4", "webm", "ogg"]
  const extension = file.name.split(".").pop()?.toLowerCase()
  return validTypes.includes(file.type) || (extension ? validExtensions.includes(extension) : false)
}

/**
 * Validate image file type
 */
export function isValidImageFile(file: { name: string; type: string }): boolean {
  const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/svg+xml"]
  const validExtensions = ["jpg", "jpeg", "png", "gif", "webp", "svg"]
  const extension = file.name.split(".").pop()?.toLowerCase()
  return validTypes.includes(file.type) || (extension ? validExtensions.includes(extension) : false)
}

/**
 * Validate document file type
 */
export function isValidDocumentFile(file: { name: string; type: string }): boolean {
  const validTypes = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "application/zip"]
  const validExtensions = ["pdf", "doc", "docx", "txt", "zip"]
  const extension = file.name.split(".").pop()?.toLowerCase()
  return validTypes.includes(file.type) || (extension ? validExtensions.includes(extension) : false)
}

function sizeFromEnv(value: string | undefined, defaultMb: number): number {
  const parsed = Number(value)
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMb
  return Math.floor(mb * 1024 * 1024)
}

/**
 * Maximum video upload size (default 50 MB - the largest single file on the Supabase free plan)
 */
export function getMaxVideoSize(): number {
  return sizeFromEnv(process.env.NEXT_PUBLIC_MAX_VIDEO_SIZE_MB, 50)
}

/**
 * Maximum image upload size (default 5 MB)
 */
export function getMaxImageSize(): number {
  return sizeFromEnv(process.env.NEXT_PUBLIC_MAX_IMAGE_SIZE_MB, 5)
}

/**
 * Maximum document upload size (default 25 MB)
 */
export function getMaxDocumentSize(): number {
  return sizeFromEnv(process.env.NEXT_PUBLIC_MAX_DOCUMENT_SIZE_MB, 25)
}

export function getVideoTooLargeMessage(): string {
  return (
    `Videos over ${Math.round(getMaxVideoSize() / 1024 / 1024)} MB can't be uploaded. ` +
    "Upload the video to YouTube (unlisted) and paste the link into the lesson instead."
  )
}

export interface UploadRules {
  maxSize: number
  isValid: (file: { name: string; type: string }) => boolean
  invalidMessage: string
}

/**
 * Validation rules per upload type, shared by the upload API routes and FileUpload.
 */
export function getUploadRules(fileType: StorageFileType): UploadRules {
  switch (fileType) {
    case "video":
    case "lesson":
      return {
        maxSize: getMaxVideoSize(),
        isValid: isValidVideoFile,
        invalidMessage: "Invalid video file type. Supported formats: MP4, WebM, OGG",
      }
    case "thumbnail":
    case "avatar":
    case "quiz":
    case "quiz-image":
    case "signature":
      return {
        maxSize: getMaxImageSize(),
        isValid: isValidImageFile,
        invalidMessage: "Invalid image file type. Supported formats: JPG, PNG, GIF, WebP, SVG",
      }
    case "certificate":
    case "certificate-template":
      return {
        maxSize: getMaxDocumentSize(),
        isValid: (file) => isValidDocumentFile(file) || isValidImageFile(file),
        invalidMessage: "Invalid file type. Supported formats: PDF, PNG, JPG, JPEG, SVG",
      }
    case "document":
    case "resource":
    default:
      return {
        maxSize: getMaxDocumentSize(),
        isValid: (file) => isValidDocumentFile(file) || isValidImageFile(file) || isValidVideoFile(file),
        invalidMessage: "Invalid file type. Supported formats: PDF, DOC, DOCX, TXT, ZIP, JPG, PNG, SVG, MP4, WebM",
      }
  }
}

/**
 * Human-readable size-limit error for an oversized file
 */
export function getFileTooLargeMessage(fileType: StorageFileType, maxSize: number): string {
  if (fileType === "video" || fileType === "lesson") {
    return getVideoTooLargeMessage()
  }
  return `File size exceeds the maximum allowed size of ${Math.round(maxSize / 1024 / 1024)} MB`
}
