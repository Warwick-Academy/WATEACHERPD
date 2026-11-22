import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError } from "@/lib/utils/errorHandler"

export async function GET() {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: profile, error: profileError } = await service.from("profiles").select("user_type").eq("id", user.id).single()
  if (profileError) {
    logError("Failed to verify admin status", profileError, { component: "admin/learner-stats", action: "GET" })
    return NextResponse.json({ error: "Failed to verify admin status" }, { status: 500 })
  }
  if (profile?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: learners, error } = await service.from("profiles")
    .select("id, enrollments(status)")
    .eq("user_type", "user")
  if (error) {
    logError("Failed to load learner statistics", error, { component: "admin/learner-stats", action: "GET" })
    return NextResponse.json({ error: "Failed to load learner statistics" }, { status: 500 })
  }
  const enrollments = (learners || []).flatMap((learner) => learner.enrollments || [])
  return NextResponse.json({
    totalLearners: learners?.length ?? 0,
    totalEnrollments: enrollments.filter((enrollment) => enrollment.status !== "cancelled").length,
    totalCompleted: enrollments.filter((enrollment) => enrollment.status === "completed").length,
  })
}
