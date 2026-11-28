import type { SupabaseClient } from "@supabase/supabase-js"
import { getQuizPercentage, type QuizGradeQuestion, type QuizGradeResult } from "./grading"
import { getPassingScore } from "./passing-score"

export async function hasPassedCourseQuizzes(
  supabase: SupabaseClient,
  userId: string,
  courseId: number,
  onlyLessonId?: number,
): Promise<boolean> {
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("minimum_quiz_score")
    .eq("id", courseId)
    .single()
  if (courseError) throw courseError

  let lessonsQuery = supabase
    .from("lessons")
    .select("id")
    .eq("course_id", courseId)
  if (onlyLessonId !== undefined) lessonsQuery = lessonsQuery.eq("id", onlyLessonId)
  const { data: lessons, error: lessonsError } = await lessonsQuery
  if (lessonsError) throw lessonsError
  const lessonIds = lessons.map((lesson) => lesson.id)
  if (lessonIds.length === 0) return onlyLessonId === undefined

  const [settingsResponse, questionsResponse, resultsResponse] = await Promise.all([
    supabase.from("quiz_settings").select("lesson_id, enabled, passing_score").in("lesson_id", lessonIds),
    supabase.from("quiz_questions").select("id, lesson_id, question_type, question_data, points").in("lesson_id", lessonIds),
    supabase.from("quiz_results").select("lesson_id, quiz_question_id, user_answer")
      .eq("user_id", userId).eq("course_id", courseId).in("lesson_id", lessonIds),
  ])
  if (settingsResponse.error) throw settingsResponse.error
  if (questionsResponse.error) throw questionsResponse.error
  if (resultsResponse.error) throw resultsResponse.error

  for (const lessonId of lessonIds) {
    const settings = settingsResponse.data.find((item) => item.lesson_id === lessonId)
    const questions: QuizGradeQuestion[] = questionsResponse.data.filter((item) => item.lesson_id === lessonId)
    if (questions.length === 0 || settings?.enabled === false) continue

    const results: QuizGradeResult[] = resultsResponse.data.filter((item) => item.lesson_id === lessonId)
    const score = getQuizPercentage(questions, results)
    const passingScore = getPassingScore(settings?.passing_score, course.minimum_quiz_score)
    if (score === null || score < passingScore) return false
  }
  return true
}

export async function hasCompletedCourseLessons(
  supabase: SupabaseClient,
  userId: string,
  courseId: number,
): Promise<boolean> {
  const [lessons, progress] = await Promise.all([
    supabase.from("lessons").select("id").eq("course_id", courseId),
    supabase.from("progress").select("lesson_id").eq("user_id", userId).eq("course_id", courseId).eq("completed", true),
  ])
  if (lessons.error) throw lessons.error
  if (progress.error) throw progress.error
  const completed = new Set(progress.data.map((item) => item.lesson_id))
  return lessons.data.length > 0 && lessons.data.every((lesson) => completed.has(lesson.id))
}
