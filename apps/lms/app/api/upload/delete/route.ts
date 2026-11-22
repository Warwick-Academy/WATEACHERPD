import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError } from "@/lib/utils/errorHandler"
import { PUBLIC_MEDIA_BUCKET, extractStoragePathFromUrl } from "@/lib/storage/shared"
import { deleteFile } from "@/lib/storage/server"

/**
 * Delete an uploaded file from Supabase Storage.
 *
 * URLs that are not in this project's public-media bucket (site-relative paths
 * such as /brand/... and /courses/..., or external URLs) are never deleted.
 * Admins can delete any public-media file; other users only files in their own
 * profile folder (their profile picture).
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { url, path, bucket } = await request.json()

  if (!url && !path) {
    return NextResponse.json({ error: "URL or path is required" }, { status: 400 })
  }

  try {
    // Resolve the storage location. Explicit paths are only accepted for the
    // public-media bucket; otherwise the URL must map to our Supabase Storage.
    let storagePath: string | null = null
    if (path && (!bucket || bucket === PUBLIC_MEDIA_BUCKET)) {
      storagePath = String(path)
    } else if (url) {
      const location = extractStoragePathFromUrl(url)
      if (location && location.bucket === PUBLIC_MEDIA_BUCKET) {
        storagePath = location.path
      }
    }

    if (!storagePath) {
      // Not one of our storage files (e.g. /brand/..., /courses/... or an
      // external URL) - leave it alone and report success.
      return NextResponse.json({ message: "File is not stored in Supabase Storage; nothing to delete" })
    }

    // Authorisation: admins can delete any file; everyone else only their own
    // profile folder.
    const ownProfilePrefix = `profile/user-${user.id}/`
    if (!storagePath.startsWith(ownProfilePrefix)) {
      const serviceSupabase = createServiceRoleClient()
      const { data: profile, error: profileError } = await serviceSupabase
        .from("profiles")
        .select("user_type")
        .eq("id", user.id)
        .single()
      if (profileError) {
        logError("Delete: failed to verify user role", profileError, {
          component: "upload/delete/route",
          action: "POST",
          userId: user.id,
        })
        return NextResponse.json({ error: "Failed to verify permissions" }, { status: 500 })
      }
      if (profile?.user_type !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    await deleteFile(storagePath)
    return NextResponse.json({ message: "File deleted successfully" })
  } catch (error: any) {
    logError("Delete error", error, {
      component: "upload/delete/route",
      action: "POST",
      userId: user.id,
    })
    return NextResponse.json(
      { error: error.message || "Failed to delete file" },
      { status: 500 }
    )
  }
}
