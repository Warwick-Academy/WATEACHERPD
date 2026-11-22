export const LESSON_LEVELS = ["beginner", "intermediate", "advanced"] as const
export type LessonLevel = typeof LESSON_LEVELS[number]
export type QuizDifficulty = "easy" | "medium" | "hard"

export function isLessonLevelArray(value: unknown): value is LessonLevel[] {
  return Array.isArray(value) && value.every(
    (level) => typeof level === "string" && LESSON_LEVELS.some((allowed) => allowed === level),
  )
}

export function getCourseLevels(lessons: readonly { levels?: readonly LessonLevel[] | null }[] | null | undefined): LessonLevel[] {
  const selected = new Set(lessons?.flatMap((lesson) => lesson.levels ?? []) ?? [])
  return LESSON_LEVELS.filter((level) => selected.has(level))
}

export function getQuizDifficulty(levels: readonly LessonLevel[] | null | undefined): QuizDifficulty {
  if (levels?.includes("beginner")) return "easy"
  if (levels?.includes("intermediate")) return "medium"
  if (levels?.includes("advanced")) return "hard"
  return "medium"
}
