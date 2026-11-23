import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { youtubeId } from "@/lib/course-import/adapters/html"
import { readYouTubeCourse } from "@/lib/course-import/adapters/youtube"
import { requireImportAdmin } from "@/lib/course-import/server"
import { lessonHtml } from "@/lib/course-import/workflow"
import { logError } from "@/lib/utils/errorHandler"

export const maxDuration = 60

type RouteContext = { params: Promise<{ id: string }> }
type AdminDb = NonNullable<Awaited<ReturnType<typeof requireImportAdmin>>["db"]>

async function suggestions(db: AdminDb, id: string) {
  if (!/^[1-9]\d*$/.test(id)) throw new Error("Invalid course ID.")
  const { data: course, error } = await db.from("courses")
    .select("id, title, source_url, updated_at, is_published, lessons(id, title, updated_at)")
    .eq("id", Number(id)).maybeSingle()
  if (error) throw new Error(`Unable to load course: ${error.message}`)
  if (!course) throw new Error("Course not found.")
  const videoId = course.source_url && youtubeId(course.source_url)
  if (!videoId) throw new Error("This course does not have a supported YouTube source URL.")
  if (course.lessons.length !== 1) throw new Error("This option requires a course with exactly one saved lesson.")
  const source = await readYouTubeCourse(course.source_url, videoId, AbortSignal.timeout(50000))
  if (source.chapterWarning) throw new Error(source.chapterWarning)
  const chapters = source.chapterSuggestions
  if (!chapters?.length) throw new Error("No usable timestamps were found in this video's description.")
  if (chapters.length > 40) throw new Error("Courses may contain at most 40 lessons.")
  const fingerprint = createHash("sha256").update(JSON.stringify({
    sourceUrl: course.source_url, courseUpdatedAt: course.updated_at, lesson: course.lessons[0], chapters,
  })).digest("hex")
  return { course, source, chapters, fingerprint }
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const auth = await requireImportAdmin()
    if (auth.response) return auth.response
    const result = await suggestions(auth.db, (await params).id)
    return NextResponse.json(result)
  } catch (error) {
    logError("Failed to load YouTube chapter suggestions", error, { component: "admin/courses/youtube-chapters" })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load chapter suggestions." }, { status: 400 })
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireImportAdmin()
    if (auth.response) return auth.response
    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }) }
    const parsed = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Confirm the replacement before continuing." }, { status: 400 })
    const { course, source, chapters, fingerprint } = await suggestions(auth.db, (await params).id)
    if (fingerprint !== parsed.data.fingerprint) return NextResponse.json({ error: "The course or video chapters changed. Reload the suggestions." }, { status: 409 })
    const lessons = chapters.map((chapter) => {
      if (!chapter.youtube) throw new Error("Invalid video chapter.")
      return {
        title: chapter.title,
        html: lessonHtml(source, chapter.url, `Watch the video section: ${chapter.title}.`, [], [chapter.youtube.videoId], chapter.youtube),
        durationMinutes: chapter.durationMinutes,
      }
    })
    const { error } = await auth.db.rpc("replace_youtube_course_lesson", {
      p_course_id: course.id, p_lesson_id: course.lessons[0].id,
      p_course_updated_at: course.updated_at, p_lesson_updated_at: course.lessons[0].updated_at,
      p_source_url: course.source_url, p_lessons: lessons,
    })
    if (error) throw new Error(`Unable to replace the lesson: ${error.message}`)
    return NextResponse.json({ lessonCount: lessons.length })
  } catch (error) {
    logError("Failed to replace lesson with YouTube chapters", error, { component: "admin/courses/youtube-chapters" })
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to replace the lesson." }, { status: 400 })
  }
}
