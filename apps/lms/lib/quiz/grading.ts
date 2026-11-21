export interface QuizGradeQuestion {
  id: number
  question_type: string
  question_data: Record<string, unknown>
  points: number | null
}

export interface QuizGradeResult {
  quiz_question_id: number | null
  user_answer: string | null
}

export function isQuizAnswerCorrect(
  type: string,
  data: Record<string, unknown>,
  answer: unknown
): boolean {
  if (type === "multiple-choice" || type === "multiple_choice") {
    const correct = data.correctOption ?? data.correct_answer ?? 0
    return answer !== null && answer !== undefined && String(answer) === String(correct)
  }
  if (type === "true-false" || type === "true_false") {
    const correct = data.correctAnswer === false ? 1 : 0
    return answer !== null && answer !== undefined && String(answer) === String(correct)
  }
  if (type === "fill-blank" || type === "fill_blank") {
    const raw = data.correctAnswers ?? data.correct_answers
    const correctAnswers = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
    return answer !== null && answer !== undefined &&
      correctAnswers.some((value) => String(value).toLowerCase() === String(answer).toLowerCase())
  }
  if (type === "short-answer" || type === "short_answer") {
    const raw = data.correctKeywords ?? data.correct_keywords
    const keywords = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
    const text = answer === null || answer === undefined ? "" : String(answer).toLowerCase()
    return keywords.some((keyword) => text.includes(String(keyword).toLowerCase()))
  }
  return false
}

export function getQuizPercentage(
  questions: QuizGradeQuestion[],
  results: QuizGradeResult[]
): number | null {
  const answers = new Map<number, string | null>()
  for (const result of results) {
    if (result.quiz_question_id === null || answers.has(result.quiz_question_id)) return null
    answers.set(result.quiz_question_id, result.user_answer)
  }
  if (questions.length === 0 || answers.size !== questions.length) return null

  let totalPoints = 0
  let earnedPoints = 0
  for (const question of questions) {
    if (!answers.has(question.id)) return null
    const points = question.points || 1
    totalPoints += points
    if (isQuizAnswerCorrect(question.question_type, question.question_data || {}, answers.get(question.id))) {
      earnedPoints += points
    }
  }
  return totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : null
}
