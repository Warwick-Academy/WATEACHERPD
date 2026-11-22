import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError, logWarning, logInfo, createErrorResponse } from "@/lib/utils/errorHandler"
import { hasPassedCourseQuizzes } from "@/lib/quiz/course-eligibility"

async function updateEnrollmentCount(client: ReturnType<typeof createServiceRoleClient>, courseId: number) {
  const { count, error } = await client.from("enrollments")
    .select("*", { count: "exact", head: true })
    .eq("course_id", courseId)
    .neq("status", "cancelled")
  if (error || count === null) {
    logError("Failed to count course enrollments", error ?? new Error("Missing enrollment count"), { component: "enrollments/route", courseId })
    return
  }
  const { error: updateError } = await client.from("courses").update({ enrolled_students: count }).eq("id", courseId)
  if (updateError) logError("Failed to update course enrollment count", updateError, { component: "enrollments/route", courseId })
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError) {
      logError("Enrollments API: Auth error", authError, {
        component: "enrollments/route",
        action: "GET",
      })
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 })
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Use service role client to bypass RLS and avoid recursion
    let serviceClient
    try {
      serviceClient = createServiceRoleClient()
    } catch (serviceError: any) {
      logWarning("Service role key not available, using regular client", {
        component: "enrollments/route",
        action: "GET",
        error: serviceError.message,
      })
      serviceClient = null
    }

    const clientToUse = serviceClient || supabase

    // Try to fetch enrollments with courses relation first
    let { data, error } = await clientToUse
      .from("enrollments")
      .select(`
        *,
        courses (*)
      `)
      .eq("user_id", user.id)
      .neq("status", "cancelled")

    // If error with courses relation, try without it (might be RLS issue even with service client)
    if (error) {
      logWarning("Enrollments API: Error with courses relation, trying without", {
        component: "enrollments/route",
        action: "GET",
        error: error.message,
        userId: user.id,
      })
      const { data: enrollmentsData, error: enrollmentsError } = await clientToUse
        .from("enrollments")
        .select("*")
        .eq("user_id", user.id)
        .neq("status", "cancelled")
      
      if (!enrollmentsError) {
        data = enrollmentsData
        error = null
      } else {
        logError("Enrollments API: Database error", enrollmentsError, {
          component: "enrollments/route",
          action: "GET",
          code: enrollmentsError.code,
          details: enrollmentsError.details,
          hint: enrollmentsError.hint,
          userId: user.id,
        })
        return NextResponse.json({ 
          error: enrollmentsError.message,
          details: enrollmentsError.details,
          hint: enrollmentsError.hint,
        }, { status: 500 })
      }
    }

    if (error) {
      logError("Enrollments API: Database error", error, {
        component: "enrollments/route",
        action: "GET",
        code: error.code,
        details: error.details,
        hint: error.hint,
        userId: user.id,
      })
      return NextResponse.json({ 
        error: error.message,
        details: error.details,
        hint: error.hint,
      }, { status: 500 })
    }

    // Return empty array if no enrollments (not an error)
    return NextResponse.json({ enrollments: data || [] })
  } catch (error: any) {
    logError("Enrollments API: Unexpected error", error, {
      component: "enrollments/route",
      action: "GET",
    })
    return NextResponse.json({ 
      error: error?.message || "An unexpected error occurred while fetching enrollments",
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { courseId, userId, bypassPrerequisites = false } = await request.json()

  // Use service role client for admin checks and enrollment operations to bypass RLS
  const serviceSupabase = createServiceRoleClient()

  // Check if user is admin if userId is provided (admin enrolling another user)
  let targetUserId = user.id
  const adminAssignment = userId !== undefined
  if (adminAssignment) {
    // Verify the requesting user is an admin using service role client to bypass RLS
    const { data: profile, error: profileError } = await serviceSupabase
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single()

    if (profileError) {
      logError("Enrollments API: Error checking admin status", profileError, {
        component: "enrollments/route",
        action: "POST",
        userId: user.id,
      })
      return NextResponse.json({ error: "Failed to verify admin status" }, { status: 500 })
    }

    if (profile?.user_type !== "admin") {
      return NextResponse.json({ error: "Forbidden: Only admins can enroll other users" }, { status: 403 })
    }

    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "A valid userId is required" }, { status: 400 })
    }
    targetUserId = userId
  }

  if (!Number.isInteger(Number(courseId)) || Number(courseId) <= 0) {
    return NextResponse.json({ error: "A valid courseId is required" }, { status: 400 })
  }

  if (adminAssignment) {
    const [{ data: course, error: courseError }, { data: target, error: targetError }] = await Promise.all([
      serviceSupabase.from("courses").select("id, is_published").eq("id", courseId).maybeSingle(),
      serviceSupabase.from("profiles").select("id").eq("id", targetUserId).maybeSingle(),
    ])
    if (courseError || targetError) {
      logError("Failed to validate assignment", courseError || targetError, { component: "enrollments/route", action: "POST" })
      return NextResponse.json({ error: "Failed to validate assignment" }, { status: 500 })
    }
    if (!course?.is_published || !target) {
      return NextResponse.json({ error: "Select an existing user and a published course" }, { status: 400 })
    }
  }

  // Check if user is already enrolled in this course
  const { data: existingEnrollment, error: checkEnrollmentError } = await serviceSupabase
    .from("enrollments")
    .select("id, status, completed_at")
    .eq("user_id", targetUserId)
    .eq("course_id", courseId)
    .maybeSingle()

  if (checkEnrollmentError && checkEnrollmentError.code !== "PGRST116") {
    logError("Enrollments API: Error checking existing enrollment", checkEnrollmentError, {
      component: "enrollments/route",
      action: "POST",
      userId: targetUserId,
      courseId,
    })
    return NextResponse.json({ error: "Failed to check enrollment status" }, { status: 500 })
  }

  if (existingEnrollment) {
    if (existingEnrollment.status === "cancelled" && adminAssignment) {
      const { data: restored, error: restoreError } = await serviceSupabase
        .from("enrollments")
        .update({ status: existingEnrollment.completed_at ? "completed" : "active" })
        .eq("id", existingEnrollment.id)
        .eq("status", "cancelled")
        .select()
        .maybeSingle()
      if (restoreError) {
        logError("Failed to restore enrollment", restoreError, { component: "enrollments/route", action: "POST", courseId })
        return NextResponse.json({ error: "Failed to restore enrollment" }, { status: 500 })
      }
      if (!restored) return NextResponse.json({ error: "Enrollment changed; refresh and try again" }, { status: 409 })
      await updateEnrollmentCount(serviceSupabase, Number(courseId))
      return NextResponse.json({ enrollment: restored })
    }
    if (existingEnrollment.status === "cancelled") {
      return NextResponse.json({ error: "This assignment was cancelled. Contact an administrator." }, { status: 403 })
    }
    return NextResponse.json({ 
      error: "User is already enrolled in this course",
      code: "already_enrolled",
      enrollment: existingEnrollment 
    }, { status: 409 }) // 409 Conflict
  }

  // Check prerequisites before enrollment (skip for paid courses)
  if (!bypassPrerequisites && !adminAssignment) {
    const { data: prerequisitesData } = await serviceSupabase
      .from("course_prerequisites")
      .select(`
        prerequisite_course_id,
        courses!course_prerequisites_prerequisite_course_id_fkey (
          id,
          title
        )
      `)
      .eq("course_id", courseId)

    if (prerequisitesData && prerequisitesData.length > 0) {
    // Get prerequisite course IDs
    const prerequisiteIds = prerequisitesData.map((p: any) => p.prerequisite_course_id)

    // Check if user has completed all prerequisites
    const { data: completedEnrollments } = await serviceSupabase
      .from("enrollments")
      .select("course_id, completed_at, progress")
      .eq("user_id", targetUserId)
      .in("course_id", prerequisiteIds)
      .not("completed_at", "is", null)

    const completedPrerequisiteIds = new Set(
      (completedEnrollments || []).map((e: any) => e.course_id)
    )

    // Find missing prerequisites
    const missingPrerequisites = prerequisitesData
      .filter((p: any) => !completedPrerequisiteIds.has(p.prerequisite_course_id))
      .map((p: any) => {
        // Check if user is enrolled but not completed
        const enrollment = completedEnrollments?.find((e: any) => e.course_id === p.prerequisite_course_id)
        const isEnrolled = enrollment !== undefined
        const isInProgress = isEnrolled && !enrollment.completed_at && enrollment.progress > 0

        return {
          id: p.prerequisite_course_id,
          title: p.courses?.title || `Course ${p.prerequisite_course_id}`,
          status: isInProgress ? "in_progress" : "not_started",
        }
      })

      if (missingPrerequisites.length > 0) {
        return NextResponse.json(
          {
            error: "Prerequisites not met",
            missingPrerequisites,
          },
          { status: 400 }
        )
      }
    }
  }

  const { data, error } = await serviceSupabase
    .from("enrollments")
    .insert({
      user_id: targetUserId,
      course_id: courseId,
      status: "active",
      progress: 0,
    })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "User is already enrolled in this course", code: "already_enrolled" }, { status: 409 })
    }
    logError("Enrollments API: Error creating enrollment", error, {
      component: "enrollments/route",
      action: "POST",
      userId: targetUserId,
      courseId,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await updateEnrollmentCount(serviceSupabase, Number(courseId))

  // Send enrollment email notification (non-blocking)
  if (data?.id && process.env.SENDGRID_API_KEY) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      const notificationUrl = new URL("/api/send-email-notification", baseUrl).toString()
      fetch(notificationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "enrollment",
          enrollmentId: data.id.toString(),
        }),
      }).catch((error) => {
        logWarning("Failed to trigger enrollment email", {
          component: "enrollments/route",
          action: "POST",
          enrollmentId: data.id,
          error: error?.message,
        })
      })
    } catch (urlError) {
      logWarning("Failed to construct notification URL", {
        component: "enrollments/route",
        action: "POST",
        enrollmentId: data.id,
        error: urlError instanceof Error ? urlError.message : String(urlError),
      })
    }
  }

  return NextResponse.json({ enrollment: data })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { courseId, status, userId } = await request.json()

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 })
  }

  if (!["active", "completed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "A valid status is required" }, { status: 400 })
  }

  // Use service role client to bypass RLS
  const serviceSupabase = createServiceRoleClient()
  let targetUserId = user.id
  if (userId !== undefined) {
    if (typeof userId !== "string" || !userId || status !== "cancelled") {
      return NextResponse.json({ error: "Admin updates must specify a user and cancelled status" }, { status: 400 })
    }
    const { data: profile, error: profileError } = await serviceSupabase.from("profiles").select("user_type").eq("id", user.id).single()
    if (profileError) {
      logError("Failed to verify admin status", profileError, { component: "enrollments/route", action: "PATCH" })
      return NextResponse.json({ error: "Failed to verify admin status" }, { status: 500 })
    }
    if (profile?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    targetUserId = userId
  }

  logInfo("Updating enrollment", { userId: targetUserId, courseId, status })

  // First check if enrollment exists
  const { data: existingEnrollment, error: checkError } = await serviceSupabase
    .from("enrollments")
    .select("*")
    .eq("user_id", targetUserId)
    .eq("course_id", courseId)
    .single()

  if (checkError && checkError.code !== "PGRST116") { // PGRST116 = not found, which is ok
    logError("Error checking enrollment", checkError, {
      component: "enrollments/route",
      action: "PATCH",
      userId: user.id,
      courseId,
    })
    return NextResponse.json({ error: checkError.message }, { status: 500 })
  }

  if (!existingEnrollment) {
    logError("Enrollment not found for user", new Error("Enrollment not found"), {
      component: "enrollments/route",
      action: "PATCH",
      userId: user.id,
      courseId,
    })
    return NextResponse.json({ error: "Enrollment not found" }, { status: 404 })
  }

  if (existingEnrollment.status === "cancelled" && userId === undefined) {
    return NextResponse.json({ error: "This assignment was cancelled. Contact an administrator." }, { status: 403 })
  }

  if (status === "completed" && existingEnrollment.status !== "completed") {
    try {
      if (!await hasPassedCourseQuizzes(serviceSupabase, user.id, Number(courseId))) {
        return NextResponse.json({ error: "Pass all course quizzes before completing this course" }, { status: 400 })
      }
    } catch (error) {
      logError("Error checking course quiz results", error, {
        component: "enrollments/route",
        action: "PATCH",
        userId: user.id,
        courseId,
      })
      return NextResponse.json({ error: "Could not verify quiz results" }, { status: 500 })
    }
  }

  // Update enrollment with status and completed_at
  const updateData: any = {
    status: status,
  }

  if (status === "completed") {
    updateData.completed_at = new Date().toISOString()
    // Also update progress to 100% if completing
    updateData.progress = 100
  } else if (status !== "cancelled") {
    updateData.completed_at = null
  }

  const wasCancelled = existingEnrollment.status === "cancelled"
  let updateQuery = serviceSupabase
    .from("enrollments")
    .update(updateData)
    .eq("user_id", targetUserId)
    .eq("course_id", courseId)
  if (userId === undefined) updateQuery = updateQuery.neq("status", "cancelled")
  const { data, error } = await updateQuery
    .select()
    .single()

  if (!error && status === "cancelled" && !wasCancelled) {
    await updateEnrollmentCount(serviceSupabase, Number(courseId))
  }

  // Send completion email notification if status changed to completed (non-blocking)
  if (status === "completed" && data?.id && existingEnrollment?.status !== "completed") {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      const notificationUrl = new URL("/api/send-email-notification", baseUrl).toString()
      
      // Send completion email to student
      fetch(notificationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "completion",
          enrollmentId: data.id.toString(),
        }),
      }).catch((error) => {
        logWarning("Failed to trigger completion email", {
          component: "enrollments/route",
          action: "PATCH",
          enrollmentId: data.id,
          error: error?.message,
        })
      })

      // Send admin notification for course completion
      fetch(notificationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "admin-completion",
          enrollmentId: data.id.toString(),
        }),
      }).catch((error) => {
        logWarning("Failed to trigger admin completion notification", {
          component: "enrollments/route",
          action: "PATCH",
          enrollmentId: data.id,
          error: error?.message,
        })
      })
    } catch (urlError) {
      logWarning("Failed to construct notification URL", {
        component: "enrollments/route",
        action: "PATCH",
        enrollmentId: data.id,
        error: urlError instanceof Error ? urlError.message : String(urlError),
      })
    }
  }

  if (error) {
    logError("Error updating enrollment", error, {
      component: "enrollments/route",
      action: "PATCH",
      userId: user.id,
      courseId,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logInfo("Enrollment updated successfully", { userId: user.id, courseId, status })
  return NextResponse.json({ enrollment: data })
}
