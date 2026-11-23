import { fetchImportUrl, validateImportUrl } from "../fetch"
import { parseSourceHtml } from "./html"
import type { LessonMaterial, SourceCourse, SourceLesson } from "./types"

export async function readGenericCourse(sourceUrl: string, signal?: AbortSignal): Promise<SourceCourse> {
  const response = await fetchImportUrl(sourceUrl, signal)
  const page = parseSourceHtml(response.body, response.url)
  if (page.text.length < 50 && page.videoIds.length === 0) {
    throw new Error(`${new URL(response.url).hostname} has no readable text or videos. Try another source.`)
  }
  const source = new URL(response.url)
  const seen = new Set<string>()
  const lessons: SourceLesson[] = []
  for (const link of page.links) {
    let url: URL
    try {
      url = validateImportUrl(link.url)
    } catch {
      continue
    }
    if (url.hostname !== source.hostname || url.href === source.href || seen.has(url.href)) continue
    if (!/\b(lesson|episode|tutorial|chapter|module|part)\b/i.test(`${url.pathname.replace(/[-_/]/g, " ")} ${link.text}`)) continue
    const title = link.text.replace(/\s+/g, " ").trim().slice(0, 500)
    if (!title) continue
    seen.add(url.href)
    lessons.push({ title, url: url.href, durationMinutes: null })
  }
  if (!lessons.length) lessons.push({ title: (page.title || source.hostname).slice(0, 500), url: source.href, durationMinutes: null })
  return {
    title: (page.title || source.hostname).slice(0, 200),
    description: page.description,
    owner: page.author,
    siteUrl: source.origin,
    lessons,
  }
}

export async function readGenericLesson(lesson: SourceLesson, signal?: AbortSignal): Promise<LessonMaterial> {
  const response = await fetchImportUrl(lesson.url, signal)
  const page = parseSourceHtml(response.body, response.url)
  if (page.text.length < 50 && page.videoIds.length === 0) {
    throw new Error(`${new URL(response.url).hostname} has no readable text or videos. Try another source.`)
  }
  return { text: page.text, videoIds: page.videoIds }
}
