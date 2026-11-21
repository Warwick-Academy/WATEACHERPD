import { createClient } from "@/lib/supabase/server"
import { logError } from "@/lib/utils/errorHandler"
import { NextResponse } from "next/server"

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
    !payload.email.trim()
  ) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: payload.email.trim(),
    })

    if (error) {
      logError("Failed to resend confirmation email", error, {
        component: "auth/resend-confirmation/route",
        action: "POST",
      })
      return NextResponse.json(
        { error: "Could not send a confirmation email. Please try again later." },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError("Confirmation email service failed", error, {
      component: "auth/resend-confirmation/route",
      action: "POST",
    })
    return NextResponse.json(
      { error: "Confirmation email is temporarily unavailable. Please try again later." },
      { status: 503 }
    )
  }
}
