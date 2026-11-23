import { LESSON_LEVELS, type LessonLevel } from "@/lib/lesson-levels"

export interface SplitLesson {
  id: number
  title: string
  overview: string
  durationMinutes: number
  levels: LessonLevel[]
  questions: boolean[]
}

export interface SectionPlan {
  title: string
  level: LessonLevel
  lessonIds: number[]
}

export interface SplitSection extends SectionPlan {
  courseId: number
  minutes: number
  pdHours: number
  thumbnailUrl: string | null
  previewUrl: string | null
  pendingPreviewUrl?: string
}

export interface CourseSplit {
  id: string
  source_course_id: number
  sections: SplitSection[]
  version: number
  updated_at: string
}

export function sectionTime(lessons: readonly SplitLesson[]) {
  const minutes = lessons.reduce((sum, lesson) => sum + lesson.durationMinutes + (lesson.questions.length ? 3 : 0), 0)
  return { minutes, pdHours: Math.ceil(minutes / 15) / 4 }
}

export function suggestSections(courseTitle: string, lessons: SplitLesson[]): SectionPlan[] {
  if (lessons.length < 2) return []
  const count = Math.max(2, Math.ceil(lessons.length / 6))
  const plans: SectionPlan[] = []
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * lessons.length / count)
    const end = Math.floor((index + 1) * lessons.length / count)
    const selected = lessons.slice(start, end)
    const level = [...LESSON_LEVELS].sort((a, b) =>
      selected.filter((lesson) => lesson.levels.includes(b)).length -
      selected.filter((lesson) => lesson.levels.includes(a)).length,
    )[0]
    plans.push({
      title: `${courseTitle}: ${selected[0].title}${selected.length > 1 ? ` – ${selected[selected.length - 1].title}` : ""}`.slice(0, 200),
      level,
      lessonIds: selected.map((lesson) => lesson.id),
    })
  }
  return plans
}
