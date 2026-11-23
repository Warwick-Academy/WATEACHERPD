import type { Question } from "@/app/admin/courses/new/types/quiz"
import type { LessonLevel } from "@/lib/lesson-levels"
import type { SourceCourse } from "./adapters/types"

export type CertificateType = "completion" | "participation" | "achievement"

export interface ImportedLesson {
  title: string
  overview: string
  html: string
  durationMinutes: number
  levels: LessonLevel[]
  questions: Question[]
  warnings: string[]
}

export interface ImportState {
  titleOverride: string
  certificateType: CertificateType
  source?: SourceCourse
  lessons?: (ImportedLesson | null)[]
  details?: { description: string; requirements: string; audience: string }
  thumbnailUrl?: string
  previewUrl?: string
  chapterChoice?: "chapters" | "single"
}

export interface ImportJob {
  id: string
  admin_id: string
  source_url: string
  status: string
  step_log: { message: string; level: "info" | "warning" | "error" }[]
  state: ImportState
  course_id: number | null
  version: number
  updated_at: string
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character)
}

export function formatVideoTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const rest = seconds % 60
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`
}

export function lessonHtml(
  course: SourceCourse,
  sourceUrl: string,
  overview: string,
  keyPoints: string[],
  videoIds: string[],
  youtube?: { videoId: string; startSeconds: number; endSeconds: number },
): string {
  const videos = videoIds.map((id, index) =>
    `${index > 0 ? "<h3>Optional extra video</h3>" : ""}<div data-youtube-video><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(id)}${youtube && id === youtube.videoId ? `?start=${youtube.startSeconds}&amp;end=${youtube.endSeconds}` : ""}" allowfullscreen></iframe></div>`,
  ).join("")
  const points = keyPoints.length ? `<ul>${keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""
  const credit = course.owner
    ? youtube ? `Video creator: ${escapeHtml(course.owner)}. Verify copyright and permissions.`
      : `Video and tutorial content © ${escapeHtml(course.owner)}, the owner and copyright holder. Used for non-public educational purposes.`
    : "Content owner not identified; please verify copyright and permissions."
  return `<p>${escapeHtml(overview)}</p>${videos}${points}<p><a href="${escapeHtml(sourceUrl)}">Read the full step-by-step tutorial on ${escapeHtml(new URL(course.siteUrl).hostname)}</a></p><p>${credit} Visit <a href="${escapeHtml(course.siteUrl)}">${escapeHtml(new URL(course.siteUrl).hostname)}</a>.</p>`
}

export function calculateTime(lessons: ImportedLesson[]) {
  const minutes = lessons.reduce((sum, lesson) => sum + lesson.durationMinutes + (lesson.questions.length ? 3 : 0), 0)
  return { minutes, pdHours: Math.ceil(minutes / 15) / 4 }
}
