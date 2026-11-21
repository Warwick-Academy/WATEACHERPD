import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logError, logWarning } from "@/lib/utils/errorHandler"

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("email" in payload) ||
    typeof payload.email !== "string" ||
    !("password" in payload) ||
    typeof payload.password !== "string" ||
    !("name" in payload) ||
    typeof payload.name !== "string"
  ) {
    return NextResponse.json(
      { error: "Email, password, and name are required" },
      { status: 400 }
    )
  }

  const { email, password, name } = payload

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.json(
      { error: "Sign up is temporarily unavailable. Please contact the site administrator." },
      { status: 503 }
    )
  }

  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    supabase = await createClient()
  } catch (error) {
    logError("Failed to initialize Supabase for signup", error, {
      component: "auth/signup/route",
      action: "POST",
    })
    return NextResponse.json(
      { error: "Sign up is temporarily unavailable. Please contact the site administrator." },
      { status: 503 }
    )
  }

  // Sign up the user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        user_type: "user",
      },
    },
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  if (!authData.user) {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
  }

  // Send welcome email notification (non-blocking)
  const nameParts = (name || "").split(" ")
  const firstName = nameParts[0] || "User"
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    const notificationUrl = new URL("/api/send-email-notification", baseUrl).toString()
    fetch(notificationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "welcome",
        userEmail: email,
        firstName,
      }),
    }).catch((error) => {
      logWarning("Failed to trigger welcome email", {
        component: "auth/signup/route",
        action: "POST",
        email,
        error: error?.message,
      })
    })
  } catch (urlError) {
    logWarning("Failed to construct notification URL", {
      component: "auth/signup/route",
      action: "POST",
      email,
      error: urlError instanceof Error ? urlError.message : String(urlError),
    })
  }

  return NextResponse.json({
    user: authData.user,
    session: authData.session,
  })
}

