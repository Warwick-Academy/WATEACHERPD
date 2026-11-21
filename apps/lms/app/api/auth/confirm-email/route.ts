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
    !("tokenHash" in payload) ||
    typeof payload.tokenHash !== "string" ||
    !payload.tokenHash
  ) {
    return NextResponse.json({ error: "Confirmation link is invalid." }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      token_hash: payload.tokenHash,
      type: "email",
    })

    if (error) {
      logError("Email confirmation failed", error, {
        component: "auth/confirm-email/route",
        action: "POST",
      })
      if (!error.status || error.status >= 500) {
        return NextResponse.json(
          { error: "Email confirmation is temporarily unavailable. Please try again later." },
          { status: 503 }
        )
      }
      return NextResponse.json(
        { error: "This confirmation link is invalid or has expired. Request a new email below." },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError("Email confirmation service failed", error, {
      component: "auth/confirm-email/route",
      action: "POST",
    })
    return NextResponse.json(
      { error: "Email confirmation is temporarily unavailable. Please try again later." },
      { status: 503 }
    )
  }
}
