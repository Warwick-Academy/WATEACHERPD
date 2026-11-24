import { z } from "zod"
import { fetchImportUrl } from "../fetch"
import { parseSourceHtml, youtubeId } from "./html"
import type { LessonMaterial, SourceCourse, SourceLesson } from "./types"

const MAX_LEARNFREE_LESSON_RESPONSE_BYTES = 25 * 1024 * 1024

const listSchema = z.object({
  isSuccessful: z.literal(true),
  data: z.object({ lessonData: z.array(z.object({
    lessonId: z.number().int().positive(),
    name: z.string().min(1).max(500),
    duration: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })) }),
})

const lessonSchema = z.object({
  isSuccessful: z.literal(true),
  data: z.object({
    courseName: z.string(),
    lessonDetails: z.object({
      overviewHtml: z.string().nullable().optional(),
      stepDetails: z.array(z.object({
        stepType: z.number(),
        content: z.string().nullable().optional(),
        videoUrl: z.string().nullable().optional(),
      })),
    }),
  }),
})

export function learnFreeSlug(sourceUrl: string): string | null {
  const url = new URL(sourceUrl)
  if (!["learnfree.org", "www.learnfree.org"].includes(url.hostname.toLowerCase())) return null
  return url.pathname.match(/^\/(?:episode|series)\/([a-z0-9-]+)\/?$/i)?.[1] || null
}

function durationMinutes(value: string | null | undefined): number | null {
  const match = value?.match(/^(\d+):(\d{1,2})$/)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes > 0 ? minutes : null
}

export async function readLearnFreeCourse(sourceUrl: string, slug: string, signal?: AbortSignal): Promise<SourceCourse> {
  const response = await fetchImportUrl(`https://api.one81.com/api/v1/Lesson/GetLessons/${encodeURIComponent(slug)}`, signal)
  const data = listSchema.parse(JSON.parse(response.body)).data
  const lessons = data.lessonData.map((lesson) => ({
    title: lesson.name,
    url: `https://www.learnfree.org/episode/${encodeURIComponent(slug)}?id=${lesson.lessonId}`,
    durationMinutes: durationMinutes(lesson.duration),
    sourceId: String(lesson.lessonId),
  }))
  const selected = lessons.find((lesson) => lesson.url === new URL(sourceUrl).href)
  return {
    title: slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: data.lessonData.find((lesson) => String(lesson.lessonId) === selected?.sourceId)?.description || "",
    owner: "GCFLearnFree.org®",
    siteUrl: "https://www.learnfree.org",
    lessons,
  }
}

export async function readLearnFreeLesson(slug: string, lesson: SourceLesson, signal?: AbortSignal): Promise<LessonMaterial & { sourceQuiz: boolean }> {
  if (!lesson.sourceId || !/^\d+$/.test(lesson.sourceId)) throw new Error("Invalid LearnFree lesson ID.")
  const response = await fetchImportUrl(
    `https://api.one81.com/api/v1/Lesson/GetByCourse/${encodeURIComponent(slug)}?nextLessonId=${lesson.sourceId}`,
    signal,
    { maxResponseBytes: MAX_LEARNFREE_LESSON_RESPONSE_BYTES },
  )
  const data = lessonSchema.parse(JSON.parse(response.body)).data.lessonDetails
  const sourceQuiz = data.stepDetails.length > 0 && data.stepDetails.every((step) => step.stepType === 3)
  const html = [data.overviewHtml || "", ...data.stepDetails.map((step) => step.content || "")].join("\n")
  const page = parseSourceHtml(html, lesson.url)
  for (const step of data.stepDetails) {
    const id = step.videoUrl ? youtubeId(step.videoUrl) : null
    if (id && !page.videoIds.includes(id)) page.videoIds.push(id)
  }
  if (!sourceQuiz && !page.text && page.videoIds.length === 0) {
    throw new Error("This LearnFree lesson contains no readable text or videos.")
  }
  return { text: page.text, videoIds: page.videoIds, sourceQuiz }
}
