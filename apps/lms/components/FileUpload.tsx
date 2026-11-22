"use client"

import { useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Upload, X, File, Image as ImageIcon, Video, FileText, CheckCircle2, Loader2 } from "lucide-react"
import { useDropzone } from "react-dropzone"
import {
  extractStoragePathFromUrl,
  getUploadRules,
  getFileTooLargeMessage,
  type StorageFileType,
} from "@/lib/storage/shared"

interface FileUploadProps {
  accept?: string
  /** Deprecated: limits now come from the storage rules per file type */
  maxSize?: number
  multiple?: boolean
  onUploadComplete?: (files: File[], urls: string[]) => void
  onRemove?: () => void // Called when file is removed
  type?: "image" | "video" | "document" | "all" | "thumbnail" | "avatar" | "certificate" | "quiz-image" | "certificate-template" | "signature" | "lesson" | "quiz" | "resource"
  className?: string
  bucket?: string
  additionalPath?: string
  courseId?: string | number // Course ID for proper folder structure
  lessonId?: string | number // Lesson ID for lesson-specific files
  resourceId?: string | number // Resource ID for resource files
  fileId?: string | number // File ID for better identification
  initialValue?: string | string[] // URL(s) to restore uploaded state
  disabled?: boolean // Disable file upload
}

/** Map the component's type prop to a storage upload type */
function toStorageFileType(type: FileUploadProps["type"], file?: File): StorageFileType {
  switch (type) {
    case "image":
      return "thumbnail"
    case "video":
    case "thumbnail":
    case "avatar":
    case "certificate":
    case "quiz-image":
    case "certificate-template":
    case "signature":
    case "lesson":
    case "quiz":
    case "resource":
    case "document":
      return type
    case "all":
    default:
      if (file?.type.startsWith("video/")) return "video"
      return "document"
  }
}

/** Upload a file directly to Supabase Storage via a signed URL, with progress */
function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", signedUrl)
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    xhr.setRequestHeader("x-upsert", "true")
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        let message = `Upload failed with status ${xhr.status}`
        try {
          const body = JSON.parse(xhr.responseText)
          if (body?.message || body?.error) message = body.message || body.error
        } catch {
          // Non-JSON error body - keep the status message
        }
        reject(new Error(message))
      }
    }
    xhr.onerror = () => reject(new Error("Network error while uploading file"))
    xhr.onabort = () => reject(new Error("Upload was cancelled"))
    xhr.send(file)
  })
}

export default function FileUpload({
  accept,
  maxSize,
  multiple = false,
  onUploadComplete,
  onRemove,
  type = "all",
  className,
  bucket,
  additionalPath,
  courseId,
  lessonId,
  resourceId,
  fileId,
  initialValue,
  disabled = false,
}: FileUploadProps) {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploaded, setUploaded] = useState(false)
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([])
  const [uploadMetadata, setUploadMetadata] = useState<Array<{ url: string; bucket: string; path: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [removedInitialValue, setRemovedInitialValue] = useState(false)

  // The display limit for the dropzone help text (based on the type prop)
  const displayRules = getUploadRules(toStorageFileType(type))

  // Restore uploaded state from initialValue (only if not explicitly removed)
  useEffect(() => {
    if (initialValue && !removedInitialValue) {
      const urls = Array.isArray(initialValue) ? initialValue : [initialValue]
      if (JSON.stringify(uploadedUrls) !== JSON.stringify(urls)) {
        setUploadedUrls(urls)
        setUploaded(true)
        if (urls.length > 0) {
          const url = urls[0]
          const location = extractStoragePathFromUrl(url)
          setUploadMetadata([{ url, bucket: location?.bucket || "", path: location?.path || "" }])
        }
      }
    } else if (!initialValue) {
      if (removedInitialValue) {
        setRemovedInitialValue(false)
      }
      if (uploadedUrls.length > 0 && files.length === 0) {
        setUploadedUrls([])
        setUploadMetadata([])
        setUploaded(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue, bucket]) // Removed removedInitialValue from deps to allow restoration on remount

  const getAcceptTypes = (): Record<string, string[]> | undefined => {
    switch (type) {
      case "image":
        return { "image/*": [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"] }
      case "video":
      case "lesson":
        return { "video/*": [".mp4", ".webm", ".ogg"] }
      case "document":
        return { "application/*": [".pdf", ".doc", ".docx", ".txt"] }
      default:
        return accept ? { [accept]: [] } : undefined
    }
  }

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      setError(null)

      // Validate type and size up front so the user gets a clear message
      for (const file of acceptedFiles) {
        const fileType = toStorageFileType(type, file)
        const rules = getUploadRules(fileType)
        if (!rules.isValid(file)) {
          setError(rules.invalidMessage)
          return
        }
        if (file.size > rules.maxSize) {
          setError(getFileTooLargeMessage(fileType, rules.maxSize))
          return
        }
      }

      if (acceptedFiles.length === 0) return
      setFiles((prev) => (multiple ? [...prev, ...acceptedFiles] : acceptedFiles))
      setUploaded(false)
      setUploading(true)
      setProgress(0)
      setUploadedUrls([])

      try {
        const urls: string[] = []
        const metadata: Array<{ url: string; bucket: string; path: string }> = []
        const totalFiles = acceptedFiles.length

        for (let i = 0; i < totalFiles; i++) {
          const file = acceptedFiles[i]
          const fileType = toStorageFileType(type, file)

          // 1. Ask the server for permission and a signed upload URL
          const signedResponse = await fetch("/api/upload/signed-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              fileType,
              contentType: file.type || "application/octet-stream",
              fileSize: file.size,
              additionalPath,
              courseId,
              lessonId,
              resourceId,
              fileId,
            }),
          })

          if (!signedResponse.ok) {
            let errorMessage = `Failed to get upload URL for ${file.name}`
            try {
              const errorData = await signedResponse.json()
              errorMessage = errorData.error || errorMessage
            } catch {
              errorMessage = signedResponse.statusText || errorMessage
            }
            throw new Error(errorMessage)
          }

          const signedData = await signedResponse.json()

          // 2. Upload the file straight to Supabase Storage (not through our API)
          await uploadToSignedUrl(signedData.signedUrl, file, (fraction) => {
            setProgress(Math.round(((i + fraction) / totalFiles) * 100))
          })

          urls.push(signedData.url)
          metadata.push({
            url: signedData.url,
            bucket: signedData.bucket,
            path: signedData.path,
          })
          setProgress(Math.round(((i + 1) / totalFiles) * 100))
        }

        setUploadedUrls(urls)
        setUploadMetadata(metadata)
        setUploading(false)
        setUploaded(true)

        // 3. Hand the final public URL(s) back to the form
        onUploadComplete?.(acceptedFiles, urls)
      } catch (err: any) {
        setError(err.message || "Upload failed")
        setUploading(false)
        setUploaded(false)
      }
    },
    [multiple, type, additionalPath, courseId, lessonId, resourceId, fileId, onUploadComplete]
  )

  const acceptTypes = getAcceptTypes()
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: accept ? { [accept]: [] } : acceptTypes,
    multiple,
    disabled: disabled || uploading || uploaded,
  })

  const removeFile = async (index?: number) => {
    // Delete file from Supabase Storage if it was uploaded
    if (index !== undefined && uploadMetadata[index]) {
      const meta = uploadMetadata[index]
      try {
        const response = await fetch("/api/upload/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: meta.url,
            bucket: meta.bucket || undefined,
            path: meta.path || undefined,
          }),
        })
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error("Failed to delete file from storage:", errorData.error || "Unknown error")
        }
      } catch (err) {
        console.error("Failed to delete file from storage:", err)
        // Continue with removal even if delete fails
      }
      setFiles((prev) => prev.filter((_, i) => i !== index))
      setUploadedUrls((prev) => prev.filter((_, i) => i !== index))
      setUploadMetadata((prev) => prev.filter((_, i) => i !== index))
    } else if (index === undefined) {
      // Remove all files (including initialValue)
      const toDelete = uploadMetadata.length > 0
        ? uploadMetadata
        : uploadedUrls.map((url) => ({ url, bucket: "", path: "" }))
      await Promise.all(
        toDelete.map((meta) =>
          fetch("/api/upload/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: meta.url,
              bucket: meta.bucket || undefined,
              path: meta.path || undefined,
            }),
          })
            .then((response) => {
              if (!response.ok) {
                return response.json().catch(() => ({})).then((errorData: any) => {
                  console.error("Failed to delete file from storage:", errorData.error || "Unknown error")
                })
              }
            })
            .catch((err) => {
              console.error("Failed to delete file from storage:", err)
            })
        )
      )
      setFiles([])
      setRemovedInitialValue(true)
      setUploadedUrls([])
      setUploadMetadata([])
    }
    setUploaded(false)
    setUploading(false)
    setProgress(0)
    setError(null)
    onRemove?.() // Notify parent that file was removed
  }

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <ImageIcon className="h-5 w-5" />
    if (file.type.startsWith("video/")) return <Video className="h-5 w-5" />
    return <FileText className="h-5 w-5" />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i]
  }

  const getFileName = (url: string) => {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const fileName = pathname.split("/").pop() || "File"
      return decodeURIComponent(fileName)
    } catch {
      return url.split("/").pop() || "File"
    }
  }

  const hasFiles = files.length > 0 || uploadedUrls.length > 0
  const showDropzone = !hasFiles && !uploading

  return (
    <div className={`w-full max-w-full overflow-hidden ${className || ""}`}>
      {/* Show drag & drop area only when no files */}
      {showDropzone && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors w-full max-w-full ${
            disabled || uploading || uploaded
              ? "border-muted-foreground/10 cursor-not-allowed opacity-50"
              : isDragActive
              ? "border-primary bg-primary/5 cursor-pointer"
              : "border-muted-foreground/25 cursor-pointer"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          {isDragActive ? (
            <p className="text-primary font-medium">Drop the files here...</p>
          ) : (
            <div>
              <p className="text-sm font-medium mb-1">
                Drag & drop files here, or click to select
              </p>
              <p className="text-xs text-muted-foreground">
                {type === "image" && "Images only"}
                {(type === "video" || type === "lesson") && "Videos only"}
                {type === "document" && "Documents only"}
                {type === "all" && "All file types"}
                {` • Max size: ${Math.round(displayRules.maxSize / 1024 / 1024)}MB`}
              </p>
              {(type === "video" || type === "lesson") && (
                <p className="text-xs text-muted-foreground mt-1">
                  For larger videos, upload to YouTube (unlisted) and paste the link instead.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Show file cards when files are selected or uploaded */}
      {hasFiles && (
        <div className="space-y-2 w-full max-w-full">
          {/* Show files from File objects */}
          {files.map((file, index) => (
            <Card
              key={index}
              className="relative overflow-hidden w-full"
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 w-full min-w-0">
                  <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
                    {getFileIcon(file)}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {uploading && (
                      <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
                    )}
                    {uploaded && !uploading && (
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                    )}
                    {!uploading && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFile(index)}
                        className="h-8 w-8 flex-shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {uploading && (
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={progress} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground w-9 text-right">{progress}%</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {/* Show restored uploaded state when initialValue is provided but no files */}
          {uploadedUrls.length > 0 && files.length === 0 && (
            <Card className="relative overflow-hidden w-full">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 w-full min-w-0">
                  <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
                    <File className="h-5 w-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className="text-sm font-medium truncate">
                        {getFileName(uploadedUrls[0])}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {uploading && (
                      <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
                    )}
                    {uploaded && !uploading && (
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                    )}
                    {!uploading && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFile()}
                        className="h-8 w-8 flex-shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* Show validation errors even before a file card exists */}
      {!hasFiles && error && (
        <div className="mt-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  )
}
