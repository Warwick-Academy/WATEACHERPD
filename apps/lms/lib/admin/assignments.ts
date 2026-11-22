export interface AssignmentLearner {
  id: string
  name: string
  email?: string
  enrolledCourses: number[]
}

export async function assignCourses(learners: readonly AssignmentLearner[], courseIds: readonly number[]) {
  const failures: string[] = []
  let assigned = 0
  for (const learner of learners) {
    for (const courseId of courseIds) {
      if (learner.enrolledCourses.includes(courseId)) continue
      try {
        const response = await fetch("/api/enrollments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: learner.id, courseId }),
        })
        if (!response.ok) {
          const result = await response.json()
          if (response.status === 409 && result.code === "already_enrolled") continue
          throw new Error(result.error || "Assignment failed")
        }
        assigned++
      } catch (error) {
        failures.push(`${learner.name}, course ${courseId}: ${error instanceof Error ? error.message : "Assignment failed"}`)
      }
    }
  }
  return { assigned, failures }
}
