import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError } from "@/lib/utils/errorHandler"
import {
  PUBLIC_MEDIA_BUCKET,
  getStoragePath,
  getUploadRules,
  getFileTooLargeMessage,
  type StorageFileType,
} from "@/lib/storage/shared"
import { uploadFile } from "@/lib/storage/server"

const VALID_TYPES: StorageFileType[] = [
  "video", "document", "thumbnail", "avatar", "certificate",
  "quiz-image", "certificate-template", "signature", "lesson", "quiz", "resource",
]

/**
 * Server-side upload to Supabase Storage for small files (e.g. profile pictures).
 * Large files must use /api/upload/signed-url and upload directly from the browser,
 * because Netlify limits request bodies to about 6 MB.
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

  const formData = await request.formData()
  const file = formData.get("file") as File
  const requestedType = (formData.get("type") as string) || "document"
  const additionalPath = (formData.get("additionalPath") as string) || undefined
  const courseId = (formData.get("courseId") as string) || undefined
  const lessonId = (formData.get("lessonId") as string) || undefined
  const resourceId = (formData.get("resourceId") as string) || undefined
  const fileId = (formData.get("fileId") as string) || undefined

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 })
  }

  try {
    let fileType: StorageFileType
    if (VALID_TYPES.includes(requestedType as StorageFileType)) {
      fileType = requestedType as StorageFileType
    } else if (file.type.startsWith("video/")) {
      fileType = "video"
    } else if (file.type.startsWith("image/")) {
      fileType = "thumbnail"
    } else {
      fileType = "resource"
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
        logError("Upload: failed to verify user role", profileError, {
          component: "upload/route",
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
    if (!rules.isValid(file)) {
      return NextResponse.json({ error: rules.invalidMessage }, { status: 400 })
    }
    if (file.size > rules.maxSize) {
      return NextResponse.json(
        { error: getFileTooLargeMessage(fileType, rules.maxSize) },
        { status: 400 }
      )
    }

    const path = getStoragePath(
      fileType,
      user.id,
      file.name,
      additionalPath,
      undefined,
      courseId,
      lessonId,
      resourceId,
      fileId
    )

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const { url } = await uploadFile(fileBuffer, path, file.type)

    return NextResponse.json({
      url,
      path,
      bucket: PUBLIC_MEDIA_BUCKET,
    })
  } catch (error: any) {
    logError("Upload error", error, {
      component: "upload/route",
      action: "POST",
      userId: user.id,
      fileType: requestedType,
    })
    return NextResponse.json(
      { error: error.message || "Failed to upload file" },
      { status: 500 }
    )
  }
}
