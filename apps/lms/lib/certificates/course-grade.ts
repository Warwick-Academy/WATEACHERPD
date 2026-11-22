import type { SupabaseClient } from "@supabase/supabase-js"
import { getQuizPercentage, type QuizGradeQuestion, type QuizGradeResult } from "@/lib/quiz/grading"

/**
 * Compute the values for the [Grade] and [PD Hours] certificate placeholders.
 *
 * - Grade: the average of the learner's quiz percentages across every lesson
 *   with an enabled quiz, rounded to a whole percentage (null when the course
 *   has no quizzes or the learner has no complete results).
 * - PD hours: the sum of the lessons' estimated durations (minutes), rounded
 *   up to the next 30-minute increment and expressed in hours (0.5, 1, 1.5, 2...).
 */
export async function getCourseGradeAndHours(
  supabase: SupabaseClient,
  userId: string,
  courseId: number
): Promise<{ grade: string | null; pdHours: string }> {
  const { data: lessons, error: lessonsError } = await supabase
    .from("lessons")
    .select("id, estimated_duration")
    .eq("course_id", courseId)
  if (lessonsError) throw lessonsError

  const totalMinutes = (lessons || []).reduce(
    (sum, lesson) => sum + (Number(lesson.estimated_duration) || 0),
    0
  )
  // Round up to the next 30-minute increment
  const hours = Math.ceil(totalMinutes / 30) / 2
  const pdHours = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)

  const lessonIds = (lessons || []).map((lesson) => lesson.id)
  if (lessonIds.length === 0) return { grade: null, pdHours }

  const [settingsResponse, questionsResponse, resultsResponse] = await Promise.all([
    supabase.from("quiz_settings").select("lesson_id, enabled").in("lesson_id", lessonIds),
    supabase.from("quiz_questions").select("id, lesson_id, question_type, question_data, points").in("lesson_id", lessonIds),
    supabase.from("quiz_results").select("lesson_id, quiz_question_id, user_answer")
      .eq("user_id", userId).eq("course_id", courseId).in("lesson_id", lessonIds),
  ])
  if (settingsResponse.error) throw settingsResponse.error
  if (questionsResponse.error) throw questionsResponse.error
  if (resultsResponse.error) throw resultsResponse.error

  const scores: number[] = []
  for (const lessonId of lessonIds) {
    const settings = settingsResponse.data.find((item) => item.lesson_id === lessonId)
    const questions: QuizGradeQuestion[] = questionsResponse.data.filter((item) => item.lesson_id === lessonId)
    if (questions.length === 0 || settings?.enabled === false) continue

    const results: QuizGradeResult[] = resultsResponse.data.filter((item) => item.lesson_id === lessonId)
    const score = getQuizPercentage(questions, results)
    if (score !== null) scores.push(score)
  }

  if (scores.length === 0) return { grade: null, pdHours }
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length
  return { grade: `${Math.round(average)}%`, pdHours }
}
