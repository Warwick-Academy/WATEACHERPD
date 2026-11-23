import { readGenericCourse, readGenericLesson } from "./generic"
import { learnFreeSlug, readLearnFreeCourse, readLearnFreeLesson } from "./learnfree"
import { youtubeId } from "./html"
import { readYouTubeCourse } from "./youtube"
import type { SourceLesson } from "./types"

export async function readCourse(sourceUrl: string, signal?: AbortSignal) {
  const slug = learnFreeSlug(sourceUrl)
  const videoId = youtubeId(sourceUrl)
  const course = slug ? await readLearnFreeCourse(sourceUrl, slug, signal)
    : videoId ? await readYouTubeCourse(sourceUrl, videoId, signal) : await readGenericCourse(sourceUrl, signal)
  if (course.lessons.length > 40) throw new Error("Courses may contain at most 40 lessons.")
  if (course.chapterSuggestions && course.chapterSuggestions.length > 40) throw new Error("Courses may contain at most 40 lessons.")
  if (!course.lessons.length) throw new Error("No lessons were found at this URL.")
  return course
}

export async function readLesson(sourceUrl: string, lesson: SourceLesson, signal?: AbortSignal) {
  if (lesson.youtube) return { text: "", videoIds: [lesson.youtube.videoId], sourceTimestamp: true }
  const slug = learnFreeSlug(sourceUrl)
  return slug ? readLearnFreeLesson(slug, lesson, signal) : readGenericLesson(lesson, signal)
}
