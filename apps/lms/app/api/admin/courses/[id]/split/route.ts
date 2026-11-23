import { NextResponse } from "next/server"
import { z } from "zod"
import { requireImportAdmin } from "@/lib/course-import/server"
import { parseSourceHtml } from "@/lib/course-import/adapters/html"
import { makeThumbnail } from "@/lib/course-import/thumbnail"
import { isLessonLevelArray } from "@/lib/lesson-levels"
import { type CourseSplit, type SplitLesson } from "@/lib/course-import/split"
import { createSignedUploadUrl, uploadFile } from "@/lib/storage/server"
import { extractStoragePathFromUrl, getPublicUrl, getStoragePath, getUploadRules, PUBLIC_MEDIA_BUCKET } from "@/lib/storage/shared"
import { logError } from "@/lib/utils/errorHandler"

export const maxDuration = 60

const planSchema = z.object({
  title: z.string().trim().min(1).max(200),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  lessonIds: z.array(z.number().int().positive()).min(1).max(40),
})
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), splitId: z.string().uuid(), sections: z.array(planSchema).min(2).max(40) }),
  z.object({ action: z.literal("thumbnail"), splitId: z.string().uuid(), index: z.number().int().min(0).max(39) }),
  z.object({ action: z.literal("preview-sign"), splitId: z.string().uuid(), index: z.number().int().min(0).max(39), contentType: z.enum(["video/mp4", "video/webm"]), fileSize: z.number().int().positive().max(50 * 1024 * 1024) }),
  z.object({ action: z.literal("preview-save"), splitId: z.string().uuid(), index: z.number().int().min(0).max(39), url: z.string().url() }),
])

type Db = NonNullable<Awaited<ReturnType<typeof requireImportAdmin>>["db"]>
type Context = { params: Promise<{ id: string }> }

async function loadLessons(db: Db, courseId: number): Promise<SplitLesson[]> {
  const { data, error } = await db.from("lessons")
    .select("id,title,text_content,estimated_duration,levels,quiz_settings(enabled),quiz_questions(id)")
    .eq("course_id", courseId).order("order_index")
  if (error) throw new Error(`Unable to load lessons: ${error.message}`)
  return (data || []).map((lesson) => {
    const settings = Array.isArray(lesson.quiz_settings) ? lesson.quiz_settings[0] : lesson.quiz_settings
    const hasQuiz = settings?.enabled !== false && Array.isArray(lesson.quiz_questions) && lesson.quiz_questions.length > 0
    const text = parseSourceHtml(lesson.text_content || "", "https://example.com").text
    return {
      id: lesson.id, title: lesson.title, overview: text.split(/(?<=[.!?])\s/)[0].slice(0, 300) || lesson.title,
      durationMinutes: Math.max(0, Number(lesson.estimated_duration) || 0),
      levels: isLessonLevelArray(lesson.levels) ? lesson.levels : [],
      questions: hasQuiz ? [true] : [],
    }
  })
}

async function loadSplit(db: Db, adminId: string, courseId: number, splitId: string): Promise<CourseSplit> {
  const { data, error } = await db.from("course_splits").select("*")
    .eq("id", splitId).eq("admin_id", adminId).eq("source_course_id", courseId).maybeSingle()
  if (error) throw new Error(`Unable to load split: ${error.message}`)
  if (!data) throw new Error("Split not found.")
  return data as CourseSplit
}

async function saveSection(db: Db, split: CourseSplit, index: number, changes: Partial<CourseSplit["sections"][number]>) {
  const sections = split.sections.map((section, i) => i === index ? { ...section, ...changes } : section)
  const { data, error } = await db.from("course_splits")
    .update({ sections, version: split.version + 1, updated_at: new Date().toISOString() })
    .eq("id", split.id).eq("version", split.version).select("*").maybeSingle()
  if (error) throw new Error(`Unable to save split progress: ${error.message}`)
  if (!data) throw new Error("Split progress changed in another request. Refresh and retry.")
  return data as CourseSplit
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const auth = await requireImportAdmin()
    if (auth.response) return auth.response
    const courseId = Number((await params).id)
    if (!Number.isSafeInteger(courseId) || courseId < 1) return NextResponse.json({ error: "Invalid course ID." }, { status: 400 })
    const [courseResult, lessons, splitResult] = await Promise.all([
      auth.db.from("courses").select("id,title,source_url").eq("id", courseId).maybeSingle(),
      loadLessons(auth.db, courseId),
      auth.db.from("course_splits").select("*").eq("admin_id", auth.user.id)
        .eq("source_course_id", courseId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ])
    if (courseResult.error || splitResult.error) throw new Error(courseResult.error?.message || splitResult.error?.message)
    if (!courseResult.data) return NextResponse.json({ error: "Course not found." }, { status: 404 })
    const split = splitResult.data as CourseSplit | null
    const sectionLessons = split ? await Promise.all(split.sections.map((section) => loadLessons(auth.db, section.courseId))) : []
    return NextResponse.json({ course: courseResult.data, lessons, split, sectionLessons })
  } catch (error) {
    logError("Failed to load course split", error, { component: "admin/courses/split" })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load course." }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const auth = await requireImportAdmin()
    if (auth.response) return auth.response
    const courseId = Number((await params).id)
    if (!Number.isSafeInteger(courseId) || courseId < 1) return NextResponse.json({ error: "Invalid course ID." }, { status: 400 })
    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }) }
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid split request." }, { status: 400 })
    const action = parsed.data
    if (action.action === "create") {
      const { data, error } = await auth.db.rpc("create_course_split", {
        p_split_id: action.splitId, p_admin_id: auth.user.id, p_course_id: courseId, p_sections: action.sections,
      }).single()
      if (error) throw new Error(`Unable to create section drafts: ${error.message}`)
      return NextResponse.json({ split: data })
    }

    const split = await loadSplit(auth.db, auth.user.id, courseId, action.splitId)
    const section = split.sections[action.index]
    if (!section) return NextResponse.json({ error: "Section not found." }, { status: 400 })
    const { data: child, error: childError } = await auth.db.from("courses")
      .select("id,is_published").eq("id", section.courseId).maybeSingle()
    if (childError) throw new Error(`Unable to load section: ${childError.message}`)
    if (!child || child.is_published) return NextResponse.json({ error: "Section draft is missing or already published." }, { status: 400 })

    if (action.action === "thumbnail") {
      if (section.thumbnailUrl) return NextResponse.json({ split })
      const lessons = await loadLessons(auth.db, section.courseId)
      const buffer = await makeThumbnail(section.title, lessons, section.minutes, section.pdHours, section.level)
      const path = getStoragePath("thumbnail", auth.user.id, `course-${section.courseId}.png`, undefined, undefined, section.courseId)
      const uploaded = await uploadFile(buffer, path, "image/png")
      const { data: savedCourse, error } = await auth.db.from("courses").update({ image: uploaded.url }).eq("id", section.courseId).eq("is_published", false).select("id").maybeSingle()
      if (error) throw new Error(`Unable to save thumbnail: ${error.message}`)
      if (!savedCourse) throw new Error("Section draft is missing or already published.")
      return NextResponse.json({ split: await saveSection(auth.db, split, action.index, { thumbnailUrl: uploaded.url }) })
    }
    if (action.action === "preview-sign") {
      if (action.fileSize > getUploadRules("video").maxSize) return NextResponse.json({ error: "Preview exceeds the video upload limit." }, { status: 400 })
      const ext = action.contentType === "video/mp4" ? "mp4" : "webm"
      const path = getStoragePath("video", auth.user.id, `section-${section.courseId}.${ext}`, undefined, undefined, section.courseId)
      const signed = await createSignedUploadUrl(path)
      const previewUrl = getPublicUrl(path)
      const updated = await saveSection(auth.db, split, action.index, { pendingPreviewUrl: previewUrl })
      return NextResponse.json({ split: updated, signedUrl: signed.signedUrl, previewUrl })
    }
    if (action.url !== section.pendingPreviewUrl) return NextResponse.json({ error: "Invalid preview URL." }, { status: 400 })
    const location = extractStoragePathFromUrl(action.url)
    if (!location || location.bucket !== PUBLIC_MEDIA_BUCKET) return NextResponse.json({ error: "Invalid preview storage path." }, { status: 400 })
    const slash = location.path.lastIndexOf("/")
    const filename = location.path.slice(slash + 1)
    const { data: files, error: storageError } = await auth.db.storage.from(PUBLIC_MEDIA_BUCKET)
      .list(location.path.slice(0, slash), { search: filename, limit: 100 })
    if (storageError) throw new Error(`Unable to verify preview: ${storageError.message}`)
    if (!files.some((file) => file.name === filename)) return NextResponse.json({ error: "Preview upload not found." }, { status: 400 })
    const { data: savedCourse, error } = await auth.db.from("courses").update({ preview_video: action.url }).eq("id", section.courseId).eq("is_published", false).select("id").maybeSingle()
    if (error) throw new Error(`Unable to save preview: ${error.message}`)
    if (!savedCourse) throw new Error("Section draft is missing or already published.")
    return NextResponse.json({ split: await saveSection(auth.db, split, action.index, { previewUrl: action.url, pendingPreviewUrl: undefined }) })
  } catch (error) {
    logError("Course split failed", error, { component: "admin/courses/split" })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Course split failed." }, { status: 500 })
  }
}
