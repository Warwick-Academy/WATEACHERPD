import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError } from "@/lib/utils/errorHandler"
import {
  PUBLIC_MEDIA_BUCKET,
  getPublicUrl,
  getStoragePath,
  getUploadRules,
  getFileTooLargeMessage,
  type StorageFileType,
} from "@/lib/storage/shared"
import { createSignedUploadUrl } from "@/lib/storage/server"

const VALID_TYPES: StorageFileType[] = [
  "video", "document", "thumbnail", "avatar", "certificate",
  "quiz-image", "certificate-template", "signature", "lesson", "quiz", "resource",
]

/**
 * Create a signed Supabase Storage upload URL for a direct browser upload.
 * Large files must not pass through our API routes (Netlify limits request
 * bodies to about 6 MB), so the browser uploads straight to Supabase.
 *
 * Only admins can upload course content, templates and signatures.
 * Any logged-in user can upload their own profile picture, but nothing else.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const {
      filename,
      fileType,
      contentType,
      fileSize,
      additionalPath,
      courseId,
      lessonId,
      resourceId,
      fileId,
    } = await request.json()

    if (!filename || !fileType || !contentType || typeof fileSize !== "number" || fileSize <= 0) {
      return NextResponse.json(
        { error: "filename, fileType, contentType and fileSize are required" },
        { status: 400 }
      )
    }

    if (!VALID_TYPES.includes(fileType)) {
      return NextResponse.json(
        { error: `Invalid file type. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }

    // Authorisation: avatars may be uploaded by any logged-in user (always into
    // their own profile folder); everything else requires an admin.
    if (fileType !== "avatar") {
      const serviceSupabase = createServiceRoleClient()
      const { data: profile, error: profileError } = await serviceSupabase
        .from("profiles")
        .select("user_type")
        .eq("id", user.id)
        .single()
      if (profileError) {
        logError("Signed upload URL: failed to verify user role", profileError, {
          component: "upload/signed-url/route",
          action: "POST",
          userId: user.id,
        })
        return NextResponse.json({ error: "Failed to verify permissions" }, { status: 500 })
      }
      if (profile?.user_type !== "admin") {
        return NextResponse.json(
          { error: "Forbidden: only admins can upload course content" },
          { status: 403 }
        )
      }
    }

    const rules = getUploadRules(fileType)
    if (!rules.isValid({ name: filename, type: contentType })) {
      return NextResponse.json({ error: rules.invalidMessage }, { status: 400 })
    }
    if (fileSize > rules.maxSize) {
      return NextResponse.json(
        { error: getFileTooLargeMessage(fileType, rules.maxSize) },
        { status: 400 }
      )
    }

    const path = getStoragePath(
      fileType,
      user.id,
      filename,
      additionalPath,
      undefined,
      courseId,
      lessonId,
      resourceId,
      fileId
    )

    const { signedUrl, token } = await createSignedUploadUrl(path)

    return NextResponse.json({
      signedUrl,
      token,
      path,
      bucket: PUBLIC_MEDIA_BUCKET,
      url: getPublicUrl(path),
    })
  } catch (error: any) {
    logError("Signed upload URL generation error", error, {
      component: "upload/signed-url/route",
      action: "POST",
      userId: user.id,
    })
    return NextResponse.json(
      { error: error.message || "Failed to create upload URL" },
      { status: 500 }
    )
  }
}
