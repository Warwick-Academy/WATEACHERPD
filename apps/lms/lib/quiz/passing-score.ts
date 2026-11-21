export function getPassingScore(
  quizPassingScore: number | null | undefined,
  courseMinimumScore: number | null | undefined
): number {
  return quizPassingScore ?? courseMinimumScore ?? 50
}
