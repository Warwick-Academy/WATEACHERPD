import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { logError } from "@/lib/utils/errorHandler"
import { hasPassedCourseQuizzes } from "@/lib/quiz/course-eligibility"

const progressSchema = z.object({
  course_id: z.number().int().positive(),
  lesson_id: z.number().int().positive(),
  completed: z.boolean(),
  completed_at: z.string().datetime().nullable().optional(),
  quiz_score: z.number().int().min(0).max(100).nullable().optional(),
  quiz_attempts: z.number().int().min(0).nullable().optional(),
}).strict()

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const courseId = searchParams.get("courseId")

  let query = supabase
    .from("progress")
    .select("*")
    .eq("user_id", user.id)

  if (courseId) {
    query = query.eq("course_id", courseId)
  }

  const { data, error } = await query

  if (error) {
    logError("Progress API GET: Supabase error", error, {
      component: "progress/route",
      action: "GET",
      userId: user.id,
      courseId: courseId ?? undefined,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ progress: data || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }) }
  const parsed = progressSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid progress data" }, { status: 400 })
  const progressData = parsed.data
  const serviceSupabase = createServiceRoleClient()
  const [enrollment, lesson] = await Promise.all([
    serviceSupabase.from("enrollments").select("status").eq("user_id", user.id).eq("course_id", progressData.course_id).maybeSingle(),
    serviceSupabase.from("lessons").select("id").eq("id", progressData.lesson_id).eq("course_id", progressData.course_id).maybeSingle(),
  ])
  if (enrollment.error || lesson.error) {
    logError("Progress API POST: Failed to verify access", enrollment.error || lesson.error, { component: "progress/route", userId: user.id })
    return NextResponse.json({ error: "Could not verify lesson access" }, { status: 500 })
  }
  if (!enrollment.data || !["active", "completed"].includes(enrollment.data.status) || !lesson.data) {
    return NextResponse.json({ error: "You must be enrolled in this course to save its lesson progress" }, { status: 403 })
  }
  if (progressData.completed) {
    try {
      if (!await hasPassedCourseQuizzes(serviceSupabase, user.id, progressData.course_id, progressData.lesson_id)) {
        return NextResponse.json({ error: "Pass this lesson's quiz before completing it" }, { status: 400 })
      }
    } catch (error) {
      logError("Progress API POST: Failed to verify quiz", error, { component: "progress/route", userId: user.id, lessonId: progressData.lesson_id })
      return NextResponse.json({ error: "Could not verify the lesson quiz" }, { status: 500 })
    }
  }

  const { data, error } = await serviceSupabase.from("progress").upsert({
    course_id: progressData.course_id,
    lesson_id: progressData.lesson_id,
    user_id: user.id,
    completed: progressData.completed,
    completed_at: progressData.completed ? new Date().toISOString() : null,
    ...(progressData.quiz_score !== undefined ? { quiz_score: progressData.quiz_score } : {}),
    ...(progressData.quiz_attempts !== undefined ? { quiz_attempts: progressData.quiz_attempts } : {}),
  }, { onConflict: "user_id,lesson_id" }).select().single()

  if (error) {
    logError("Progress API POST: Supabase error", error, {
      component: "progress/route",
      action: "POST",
      userId: user.id,
      lessonId: progressData.lesson_id,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ progress: data })
}

