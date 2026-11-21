import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError, logWarning, logInfo, createErrorResponse } from "@/lib/utils/errorHandler"

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

  const progressData = await request.json()

  logInfo("Progress API POST: Received data", { progressData, userId: user.id })

  // Check if progress record already exists
  const { data: existingProgress } = await supabase
    .from("progress")
    .select("*")
    .eq("user_id", user.id)
    .eq("lesson_id", progressData.lesson_id)
    .single()

  let data, error

  if (existingProgress) {
    // Update existing record
    const { data: updatedData, error: updateError } = await supabase
      .from("progress")
      .update({
        ...progressData,
        user_id: user.id,
      })
      .eq("user_id", user.id)
      .eq("lesson_id", progressData.lesson_id)
      .select()
      .single()
    
    data = updatedData
    error = updateError
  } else {
    // Insert new record
    const { data: insertedData, error: insertError } = await supabase
      .from("progress")
      .insert({
        ...progressData,
        user_id: user.id,
      })
      .select()
      .single()
    
    data = insertedData
    error = insertError
  }

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

