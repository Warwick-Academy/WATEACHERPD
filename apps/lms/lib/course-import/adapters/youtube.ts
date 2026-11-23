import { z } from "zod"
import { fetchImportUrl, validateImportUrl } from "../fetch"
import type { SourceCourse, SourceLesson } from "./types"

const playerSchema = z.object({
  playabilityStatus: z.object({ status: z.string() }),
  videoDetails: z.object({
    videoId: z.string(),
    title: z.string().min(1),
    author: z.string().optional(),
    shortDescription: z.string().optional(),
    lengthSeconds: z.string().regex(/^\d+$/),
  }),
})

function playerResponse(html: string): unknown {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/.exec(html)
  if (!marker) throw new Error("YouTube did not provide video metadata. Try again later.")
  const start = marker.index + marker[0].length
  if (html[start] !== "{") throw new Error("YouTube returned invalid video metadata.")
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < html.length; index++) {
    const character = html[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === "{") depth++
    else if (character === "}" && --depth === 0) return JSON.parse(html.slice(start, index + 1))
  }
  throw new Error("YouTube returned incomplete video metadata.")
}

export function youtubeChapters(description: string, durationSeconds: number, videoId: string, url: string): SourceLesson[] {
  const chapters: { title: string; seconds: number }[] = []
  for (const line of description.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{1,3}):(\d{2})(?::(\d{2}))?\s*(?:[-–—|]\s*)?(.+?)\s*$/)
    if (!match) continue
    const first = Number(match[1]), second = Number(match[2]), third = match[3] === undefined ? null : Number(match[3])
    if (second >= 60 || (third !== null && third >= 60)) return []
    const seconds = third === null ? first * 60 + second : first * 3600 + second * 60 + third
    if (seconds >= durationSeconds || (chapters.length && seconds <= chapters[chapters.length - 1].seconds)) return []
    chapters.push({ title: match[4].trim().slice(0, 500), seconds })
  }
  if (chapters.length < 2) return []
  if (/^(intro(?:duction)?\b|welcome\b)/i.test(chapters[0].title) && /^module\s*\d+\b/i.test(chapters[1].title)) {
    chapters.shift()
  }
  if (chapters.length < 2) return []
  return chapters.map((chapter, index) => {
    const startSeconds = index === 0 ? 0 : chapter.seconds
    const endSeconds = chapters[index + 1]?.seconds ?? durationSeconds
    return {
      title: chapter.title, url, durationMinutes: Math.ceil((endSeconds - startSeconds) / 60),
      youtube: { videoId, startSeconds, endSeconds },
    }
  })
}

export async function readYouTubeCourse(sourceUrl: string, videoId: string, signal?: AbortSignal): Promise<SourceCourse> {
  validateImportUrl(sourceUrl)
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const response = await fetchImportUrl(url, signal)
  const parsed = playerSchema.safeParse(playerResponse(response.body))
  if (!parsed.success || parsed.data.videoDetails.videoId !== videoId) throw new Error("YouTube returned invalid video metadata.")
  const { playabilityStatus, videoDetails } = parsed.data
  if (playabilityStatus.status !== "OK") throw new Error("This YouTube video is not publicly available for import.")
  const duration = Number(videoDetails.lengthSeconds)
  if (!Number.isSafeInteger(duration) || duration <= 0) throw new Error("YouTube did not provide a valid video duration.")
  const title = videoDetails.title.slice(0, 200)
  const lessons: SourceLesson[] = [{
    title, url, durationMinutes: Math.ceil(duration / 60),
    youtube: { videoId, startSeconds: 0, endSeconds: duration },
  }]
  const chapters = youtubeChapters(videoDetails.shortDescription || "", duration, videoId, url)
  return {
    title, description: (videoDetails.shortDescription || "").slice(0, 30000),
    owner: videoDetails.author || "", siteUrl: "https://www.youtube.com", lessons,
    ...(chapters.length > 40 ? { chapterWarning: "More than 40 video lessons were found; importing as one video instead." }
      : chapters.length ? { chapterSuggestions: chapters } : {}),
  }
}
