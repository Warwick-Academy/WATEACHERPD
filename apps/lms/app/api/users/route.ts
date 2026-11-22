import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError, logWarning, logInfo, createErrorResponse } from "@/lib/utils/errorHandler"
import { randomBytes } from "node:crypto"

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Use service role client to bypass RLS when checking admin status
  let serviceClient
  try {
    serviceClient = createServiceRoleClient()
  } catch (serviceError: any) {
    logWarning("Service role key not available, using regular client", {
      component: "users/route",
      action: "GET",
      error: serviceError.message,
    })
    serviceClient = null
  }

  // Try to fetch profile using service role client first (bypasses RLS)
  let profile = null
  let profileError = null

  if (serviceClient) {
    const { data, error: err } = await serviceClient
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single()
    
    profile = data
    profileError = err
  } else {
    // Fallback to regular client if service role not available
    const { data, error: err } = await supabase
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single()
    
    profile = data
    profileError = err
  }

  if (profileError) {
    logError("Error fetching profile for admin check", profileError, {
      component: "users/route",
      action: "GET",
      userId: user.id,
    })
    return NextResponse.json({ error: "Failed to verify admin status" }, { status: 500 })
  }

  if (profile?.user_type !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Use service role client for admin queries to bypass RLS
  const adminClient = serviceClient || supabase

  const { searchParams } = new URL(request.url)
  const userType = searchParams.get("userType") // "admin" | "user" | null (all)

  // Build query with enrollments for user type
  let query = adminClient
    .from("profiles")
    .select(`
      *,
      enrollments (
        course_id,
        status,
        progress
      )
    `)
    .order("created_at", { ascending: false })

  if (userType) {
    query = query.eq("user_type", userType)
  }

  const { data: users, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Process users to include enrollment counts
  const processedUsers = (users || []).map((user: any) => {
    const enrollments = user.enrollments || []
    const enrolledCourses = enrollments.filter((e: any) => e.status !== "cancelled").map((e: any) => e.course_id)
    const completedCourses = enrollments.filter((e: any) => e.status === "completed").map((e: any) => e.course_id)
    
    return {
      ...user,
      enrolledCourses,
      completedCourses,
      enrolledCoursesCount: enrolledCourses.length,
      completedCoursesCount: completedCourses.length,
    }
  })

  return NextResponse.json({ users: processedUsers })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Use service role client to bypass RLS when checking admin status
  let serviceClient
  try {
    serviceClient = createServiceRoleClient()
  } catch (serviceError: any) {
    logWarning("Service role key not available, using regular client", {
      component: "users/route",
      action: "GET",
      error: serviceError.message,
    })
    serviceClient = null
  }

  // Try to fetch profile using service role client first (bypasses RLS)
  let adminProfile = null
  let adminProfileError = null

  if (serviceClient) {
    const { data, error: err } = await serviceClient
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single()
    
    adminProfile = data
    adminProfileError = err
  } else {
    // Fallback to regular client if service role not available
    const { data, error: err } = await supabase
      .from("profiles")
      .select("user_type")
      .eq("id", user.id)
      .single()
    
    adminProfile = data
    adminProfileError = err
  }

  if (adminProfileError) {
    logError("Error fetching profile for admin check", adminProfileError, {
      component: "users/route",
      action: "POST",
      userId: user.id,
    })
    return NextResponse.json(createErrorResponse(adminProfileError, 500, { userId: user.id }), { status: 500 })
  }

  if (adminProfile?.user_type !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!serviceClient) {
    return NextResponse.json({ error: "User creation is not configured on the server" }, { status: 500 })
  }

  const { email, password, name, userType, generatePassword } = await request.json()
  if (typeof name !== "string" || !name.trim() || typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      (userType !== "user" && userType !== "admin") ||
      (generatePassword !== true && (typeof password !== "string" || password.length < 8))) {
    return NextResponse.json({ error: "Provide a name, valid email, role and password of at least 8 characters" }, { status: 400 })
  }

  const temporaryPassword = generatePassword === true ? `Aa1!${randomBytes(18).toString("base64url")}` : undefined
  const { data: authUser, error: authError } = await serviceClient.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: temporaryPassword ?? password,
    email_confirm: true,
    user_metadata: { name: name.trim() },
  })

  if (authError || !authUser.user) {
    logError("Error creating user", authError || new Error("Missing created user"), { component: "users/route", action: "POST" })
    const duplicate = authError?.code === "email_exists" || authError?.code === "user_already_exists" || authError?.status === 422
    return NextResponse.json({ error: duplicate ? "An account with this email may already exist, or the account details are invalid." : "Failed to create user" }, { status: duplicate ? 409 : 500 })
  }

  // The auth trigger creates the profile; update it rather than inserting a duplicate.
  const { data: newProfile, error: profileError } = await serviceClient
    .from("profiles")
    .update({ name: name.trim(), user_type: userType })
    .eq("id", authUser.user.id)
    .select()
    .single()

  if (profileError || !newProfile) {
    logError("Error updating newly created profile", profileError || new Error("Missing profile"), { component: "users/route", action: "POST" })
    const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(authUser.user.id)
    if (rollbackError) {
      logError("Failed to remove account after profile error", rollbackError, { component: "users/route", action: "POST", userId: authUser.user.id })
      return NextResponse.json({ error: "Account creation was incomplete; an administrator must inspect the account before retrying." }, { status: 500 })
    }
    return NextResponse.json({ error: "Failed to create user profile" }, { status: 500 })
  }

  return NextResponse.json({ user: newProfile, ...(temporaryPassword ? { temporaryPassword } : {}) }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  })
}

