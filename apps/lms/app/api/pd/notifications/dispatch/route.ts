import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { dispatchMyNotifications } from "@/lib/pd/notifications"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 })
    const token = process.env.PD_DISPATCH_TOKEN
    if (!token) throw new Error("PD_DISPATCH_TOKEN is not configured.")
    const result = await dispatchMyNotifications(supabase, token)
    if (result.failures) return NextResponse.json({ error: "Some notifications could not be sent." }, { status: 502 })
    return NextResponse.json(result)
  } catch (error) {
    console.error("PD notification dispatch failed:", error)
    return NextResponse.json({ error: "Notification delivery could not be confirmed." }, { status: 500 })
  }
}
