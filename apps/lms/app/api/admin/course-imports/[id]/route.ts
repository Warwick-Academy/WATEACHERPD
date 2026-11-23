import { NextResponse } from "next/server"
import { z } from "zod"
import { logError } from "@/lib/utils/errorHandler"
import { readCourse, readLesson } from "@/lib/course-import/adapters"
import { fetchImportUrl } from "@/lib/course-import/fetch"
import { generateCourseDetails, generateLesson } from "@/lib/course-import/generation"
import { getImportJob, requireImportAdmin, saveImportJob } from "@/lib/course-import/server"
import { makeThumbnail } from "@/lib/course-import/thumbnail"
import { calculateTime, lessonHtml, type ImportedLesson, type ImportJob } from "@/lib/course-import/workflow"
import { createSignedUploadUrl, uploadFile } from "@/lib/storage/server"
import { extractStoragePathFromUrl, getFileTooLargeMessage, getStoragePath, getUploadRules, PUBLIC_MEDIA_BUCKET } from "@/lib/storage/shared"

export const maxDuration = 60

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("choose-chapters"), choice: z.enum(["chapters", "single"]) }),
  z.object({ action: z.literal("lesson"), index: z.number().int().min(0).max(39) }),
  z.object({ action: z.literal("describe") }),
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("thumbnail") }),
  z.object({ action: z.literal("preview-sign"), contentType: z.enum(["video/mp4", "video/webm"]), fileSize: z.number().int().positive().max(50 * 1024 * 1024) }),
  z.object({ action: z.literal("publish"), previewUrl: z.string().url().optional(), previewWarning: z.string().max(500).optional() }),
])

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const auth = await requireImportAdmin()
    if (auth.response) return auth.response
    const job = await getImportJob(auth.db, auth.user.id, (await params).id)
    return NextResponse.json({ import: job })
  } catch (error) {
    logError("Failed to load course import", error, { component: "admin/course-imports/[id]" })
    return NextResponse.json({ error: "Unable to load import." }, { status: 500 })
  }
}

async function youtubeDuration(id: string, signal: AbortSignal): Promise<number | null> {
  try {
    const result = await fetchImportUrl(`https://www.youtube.com/watch?v=${id}`, AbortSignal.any([signal, AbortSignal.timeout(1500)]))
    const seconds = Number(result.body.match(/"lengthSeconds"\s*:\s*"(\d+)"/)?.[1])
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null
  } catch (error) {
    console.warn("[Course import] Could not read video duration:", error instanceof Error ? error.message : String(error))
    return null
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const signal = AbortSignal.timeout(50000)
  let job: ImportJob | undefined
  let auth: Awaited<ReturnType<typeof requireImportAdmin>> | undefined
  let phase = "Import step"
  try {
    auth = await requireImportAdmin()
    if (auth.response) return auth.response
    job = await getImportJob(auth.db, auth.user.id, (await params).id)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Invalid import step." }, { status: 400 })
    const action = parsed.data
    const state = job.state
    if (job.status === "completed") return NextResponse.json({ import: job })

    if (action.action === "read") {
      if (state.source) return NextResponse.json({ import: job })
      phase = "Reading the course page"
      const source = await readCourse(job.source_url, signal)
      const updated = await saveImportJob(auth.db, job, { ...state, source, lessons: source.lessons.map(() => null) },
        "lessons", `${source.chapterSuggestions ? `Found ${source.chapterSuggestions.length} suggested timestamped lessons. Review them before continuing.` : `Found ${source.lessons.length} lessons.`}${source.chapterWarning ? ` ${source.chapterWarning}` : ""}${source.owner ? "" : " Content owner not identified; verify copyright and permissions."}`,
        source.owner && !source.chapterWarning ? "info" : "warning")
      return NextResponse.json({ import: updated })
    }

    if (action.action === "choose-chapters") {
      if (!state.source?.chapterSuggestions || state.chapterChoice || state.lessons?.some(Boolean) || job.course_id) {
        return NextResponse.json({ error: "Chapter suggestions are not available for selection." }, { status: 400 })
      }
      const source = { ...state.source, lessons: action.choice === "chapters" ? state.source.chapterSuggestions : state.source.lessons }
      const updated = await saveImportJob(auth.db, job,
        { ...state, source, lessons: source.lessons.map(() => null), chapterChoice: action.choice },
        "lessons", action.choice === "chapters" ? `Selected ${source.lessons.length} timestamped lessons.` : "Selected one full-video lesson.")
      return NextResponse.json({ import: updated })
    }

    if (action.action === "lesson") {
      const source = state.source
      const lessons = state.lessons
      if (source?.chapterSuggestions && !state.chapterChoice) return NextResponse.json({ error: "Review the timestamp suggestions first." }, { status: 400 })
      const sourceLesson = source?.lessons[action.index]
      if (!source || !lessons || !sourceLesson) return NextResponse.json({ error: "Read the course before processing lessons." }, { status: 400 })
      if (lessons[action.index]) return NextResponse.json({ import: job })
      phase = `Reading lesson ${action.index + 1}`
      const material = await readLesson(job.source_url, sourceLesson, signal)
      const warnings: string[] = []
      const sourceQuiz = "sourceQuiz" in material && material.sourceQuiz
      const timestampedVideo = "sourceTimestamp" in material && material.sourceTimestamp
      let generated: Awaited<ReturnType<typeof generateLesson>>
      if (sourceQuiz || timestampedVideo || !material.text.trim()) {
        generated = {
          overview: sourceQuiz ? "This entry links to the original source quiz."
            : timestampedVideo ? `Watch the video section: ${sourceLesson.title}.` : "This lesson links to the original source material.",
          keyPoints: [], levels: [], questions: [], warning: undefined,
        }
        warnings.push(sourceQuiz ? "Source-only quiz included without a video or generated quiz."
          : timestampedVideo ? "No transcript was imported; add lesson content, level and quiz manually."
          : "No readable source text; no AI overview, level or quiz was generated.")
      } else {
        phase = `Generating the overview and quiz for lesson ${action.index + 1}`
        generated = await generateLesson(sourceLesson.title, material.text, signal)
        if (generated.warning) warnings.push(generated.warning)
      }
      if (!sourceQuiz && !material.videoIds.length) warnings.push("No embeddable YouTube video was found.")
      let duration = sourceLesson.durationMinutes
      if (duration === null && material.videoIds.length) duration = await youtubeDuration(material.videoIds[0], signal)
      if (duration === null) {
        duration = 10
        warnings.push("Duration was unavailable; estimated at 10 minutes.")
      }
      const result: ImportedLesson = {
        title: sourceLesson.title, overview: generated.overview,
        html: lessonHtml(source, sourceLesson.url, generated.overview, generated.keyPoints, material.videoIds, sourceLesson.youtube),
        durationMinutes: duration, levels: generated.levels, questions: generated.questions, warnings,
      }
      const next = [...lessons]
      next[action.index] = result
      const updated = await saveImportJob(auth.db, job, { ...state, lessons: next }, "lessons",
        `Lesson ${action.index + 1} of ${lessons.length}: ${result.title}${warnings.length ? ` — ${warnings.join(" ")}` : " ✓"}`,
        warnings.length ? "warning" : "info")
      return NextResponse.json({ import: updated })
    }

    const lessons = state.lessons?.filter((lesson): lesson is ImportedLesson => lesson !== null)
    if (!state.source || !lessons || lessons.length !== state.source.lessons.length) {
      return NextResponse.json({ error: "Complete every lesson first." }, { status: 400 })
    }
    const title = state.titleOverride || state.source.title
    const { minutes, pdHours } = calculateTime(lessons)
    if (action.action === "describe") {
      if (state.details) return NextResponse.json({ import: job })
      phase = "Generating the course description"
      const details = await generateCourseDetails(title, lessons.map((lesson) => `${lesson.title}: ${lesson.overview}`).join("\n").slice(0, 20000), signal)
      const updated = await saveImportJob(auth.db, job, { ...state, details }, "ready", "Course description and requirements prepared.")
      return NextResponse.json({ import: updated })
    }

    if (action.action === "create") {
      if (job.course_id) return NextResponse.json({ import: job })
      if (!state.details) return NextResponse.json({ error: "Prepare course details first." }, { status: 400 })
      const [settingsResponse, signatureResponse] = await Promise.all([
        auth.db.from("platform_settings").select("*").limit(1).maybeSingle(),
        auth.db.from("courses").select("signature_image, signature_name, signature_title")
          .or("signature_image.not.is.null,signature_name.not.is.null,signature_title.not.is.null")
          .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ])
      if (settingsResponse.error || signatureResponse.error) throw new Error("Unable to load certificate settings.")
      const settings = settingsResponse.data || {}
      const signature = signatureResponse.data
      const type = state.certificateType
      const descriptions = {
        completion: "This certifies that [Student Name] has successfully completed [Course Name].",
        participation: "This certifies that [Student Name] has participated in [Course Name], a Warwick Academy professional development session.",
        achievement: "This certifies that [Student Name] has achieved distinction in [Course Name].",
      }
      const timeText = `Approximate time: ${minutes} minutes. PD credit: ${pdHours} ${pdHours === 1 ? "hour" : "hours"}.`
      const intro = state.details.description.slice(0, 398 - timeText.length).trim()
      const description = `${/[.!?]$/.test(intro) ? intro : `${intro}.`} ${timeText}`
      const course = {
        title, description, requirements: state.details.requirements, audience: state.details.audience, pdHours,
        certificateType: type,
        certificateTemplate: settings[`certificate_template_${type}`] || `https://wateacherpd.netlify.app/brand/certificates/certificate-${type}.png`,
        certificateDescription: descriptions[type],
        additionalText: `Professional development hours awarded: ${pdHours}`,
        signatureImage: signature?.signature_image || null, signatureName: signature?.signature_name || null, signatureTitle: signature?.signature_title || null,
      }
      const { error } = await auth.db.rpc("create_imported_course", {
        p_import_id: job.id, p_admin_id: auth.user.id, p_course: course, p_lessons: lessons,
      })
      if (error) throw new Error(`Failed to create course: ${error.message}`)
      const updated = await getImportJob(auth.db, auth.user.id, job.id)
      return NextResponse.json({ import: updated })
    }

    if (!job.course_id) return NextResponse.json({ error: "Create the course before generating media." }, { status: 400 })
    if (action.action === "thumbnail") {
      if (state.thumbnailUrl) return NextResponse.json({ import: job })
      const buffer = await makeThumbnail(title, lessons, minutes, pdHours)
      const path = getStoragePath("thumbnail", auth.user.id, `course-${job.course_id}.png`, undefined, undefined, job.course_id)
      const uploaded = await uploadFile(buffer, path, "image/png")
      const { error } = await auth.db.from("courses").update({ image: uploaded.url }).eq("id", job.course_id)
      if (error) throw new Error(`Failed to save thumbnail: ${error.message}`)
      const updated = await saveImportJob(auth.db, job, { ...state, thumbnailUrl: uploaded.url }, "media", "Thumbnail created.")
      return NextResponse.json({ import: updated })
    }

    if (action.action === "preview-sign") {
      const rules = getUploadRules("video")
      if (action.fileSize > rules.maxSize) return NextResponse.json({ error: getFileTooLargeMessage("video", rules.maxSize) }, { status: 400 })
      const extension = action.contentType === "video/mp4" ? "mp4" : "webm"
      const path = getStoragePath("video", auth.user.id, `course-${job.course_id}-preview.${extension}`, undefined, undefined, job.course_id)
      const signed = await createSignedUploadUrl(path)
      const { getPublicUrl } = await import("@/lib/storage/shared")
      const previewUrl = getPublicUrl(path)
      const updated = await saveImportJob(auth.db, job, { ...state, previewUrl }, "media", "Preview upload prepared.")
      return NextResponse.json({ import: updated, signedUrl: signed.signedUrl, previewUrl })
    }

    if (!state.thumbnailUrl) return NextResponse.json({ error: "Generate the thumbnail before publishing." }, { status: 400 })
    if (action.previewUrl && action.previewUrl !== state.previewUrl) {
      return NextResponse.json({ error: "Invalid preview URL." }, { status: 400 })
    }
    if (!action.previewUrl && !action.previewWarning) {
      return NextResponse.json({ error: "Provide a preview or a reason for skipping it." }, { status: 400 })
    }
    if (action.previewUrl) {
      const location = extractStoragePathFromUrl(action.previewUrl)
      if (!location || location.bucket !== PUBLIC_MEDIA_BUCKET) return NextResponse.json({ error: "Invalid preview storage path." }, { status: 400 })
      const path = location.path
      const slash = path.lastIndexOf("/")
      const { data: files, error } = await auth.db.storage.from(PUBLIC_MEDIA_BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 100 })
      if (error) throw new Error(`Failed to verify preview upload: ${error.message}`)
      if (!files.some((file) => file.name === path.slice(slash + 1))) {
        return NextResponse.json({ error: "Preview upload was not found. Retry it or skip the preview." }, { status: 400 })
      }
    }
    const { data: updated, error } = await auth.db.rpc("publish_imported_course", {
      p_import_id: job.id, p_admin_id: auth.user.id,
      p_preview_url: action.previewUrl || null, p_warning: action.previewWarning || null,
    }).single()
    if (error) throw new Error(`Failed to publish course: ${error.message}`)
    return NextResponse.json({ import: updated })
  } catch (error) {
    logError("Course import step failed", error, { component: "admin/course-imports/[id]", importId: job?.id })
    const timedOut = signal.aborted || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    const message = timedOut
      ? `${phase} timed out. Please resume the import to retry this step.`
      : error instanceof Error ? error.message : "Import step failed."
    if (auth?.db && job) {
      try {
        await saveImportJob(auth.db, job, job.state, job.status, message, "error")
      } catch (logFailure) {
        logError("Failed to save import error", logFailure, { component: "admin/course-imports/[id]", importId: job.id })
      }
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
