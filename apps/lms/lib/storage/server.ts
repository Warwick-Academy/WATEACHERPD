/**
 * Server-only Supabase Storage operations (service role).
 * Do not import from client components - use "@/lib/storage/shared" there instead.
 */
import "server-only"
import { createServiceRoleClient } from "@/lib/supabase/server"
import { PUBLIC_MEDIA_BUCKET, getPublicUrl } from "./shared"

export * from "./shared"

/**
 * Upload a file from the server (small files only, e.g. generated certificate PDFs)
 */
export async function uploadFile(
  file: Buffer | Uint8Array,
  path: string,
  contentType: string,
  bucket: string = PUBLIC_MEDIA_BUCKET
): Promise<{ path: string; url: string }> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType,
    upsert: true,
  })
  if (error) {
    throw new Error(`Failed to upload file to storage: ${error.message}`)
  }
  return { path, url: getPublicUrl(path, bucket) }
}

/**
 * Create a signed upload URL so the browser can upload directly to Supabase Storage.
 * The returned token authorises a single upload to exactly this path.
 */
export async function createSignedUploadUrl(
  path: string,
  bucket: string = PUBLIC_MEDIA_BUCKET
): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: true })
  if (error || !data) {
    throw new Error(`Failed to create signed upload URL: ${error?.message || "unknown error"}`)
  }
  return { signedUrl: data.signedUrl, token: data.token, path: data.path }
}

/**
 * Create a short-lived signed URL for reading a private file
 */
export async function getSignedUrl(
  path: string,
  expiresIn: number = 3600,
  bucket: string = PUBLIC_MEDIA_BUCKET
): Promise<string> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error || !data) {
    throw new Error(`Failed to create signed URL: ${error?.message || "unknown error"}`)
  }
  return data.signedUrl
}

/**
 * Download a file from storage (works for private buckets)
 */
export async function downloadFile(path: string, bucket: string = PUBLIC_MEDIA_BUCKET): Promise<Buffer> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) {
    throw new Error(`Failed to download file from storage: ${error?.message || "unknown error"}`)
  }
  return Buffer.from(await data.arrayBuffer())
}

/**
 * Delete one file. Missing files are treated as already deleted.
 */
export async function deleteFile(path: string, bucket: string = PUBLIC_MEDIA_BUCKET): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error && !/not.?found/i.test(error.message)) {
    throw new Error(`Failed to delete file from storage: ${error.message}`)
  }
}

/**
 * Delete everything under a folder path (recursively)
 */
export async function deleteFolder(prefix: string, bucket: string = PUBLIC_MEDIA_BUCKET): Promise<number> {
  const supabase = createServiceRoleClient()
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "")
  if (!cleanPrefix) {
    throw new Error("Refusing to delete the entire bucket: empty folder path")
  }

  // Collect every file path first, then delete, so pagination stays stable
  const filePaths: string[] = []
  const folders: string[] = [cleanPrefix]
  const pageSize = 100

  while (folders.length > 0) {
    const current = folders.pop()!
    let offset = 0

    for (;;) {
      const { data: entries, error } = await supabase.storage
        .from(bucket)
        .list(current, { limit: pageSize, offset })
      if (error) {
        throw new Error(`Failed to list storage folder ${current}: ${error.message}`)
      }
      if (!entries || entries.length === 0) break

      for (const entry of entries) {
        if (entry.id === null) {
          folders.push(`${current}/${entry.name}`)
        } else {
          filePaths.push(`${current}/${entry.name}`)
        }
      }

      if (entries.length < pageSize) break
      offset += entries.length
    }
  }

  for (let i = 0; i < filePaths.length; i += pageSize) {
    const batch = filePaths.slice(i, i + pageSize)
    const { error: removeError } = await supabase.storage.from(bucket).remove(batch)
    if (removeError) {
      throw new Error(`Failed to delete files under ${cleanPrefix}: ${removeError.message}`)
    }
  }

  return filePaths.length
}
