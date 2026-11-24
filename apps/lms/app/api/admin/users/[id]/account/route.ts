import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import { logError } from "@/lib/utils/errorHandler"
import { NextResponse } from "next/server"

async function authorize() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const service = createServiceRoleClient()
  const { data: profile, error } = await service.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (error) {
    logError("Failed to verify admin status", error, { component: "admin/users/account", action: "authorize" })
    return { response: NextResponse.json({ error: "Failed to verify admin status" }, { status: 500 }) }
  }
  if (profile?.user_type !== "admin") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { supabase, service }
}

async function getAccount(service: ReturnType<typeof createServiceRoleClient>, id: string) {
  const { data, error } = await service.auth.admin.getUserById(id)
  if (error) {
    if (error.status === 404) return { response: NextResponse.json({ error: "Account not found" }, { status: 404 }) }
    logError("Failed to load account", error, { component: "admin/users/account", action: "getAccount", userId: id })
    return { response: NextResponse.json({ error: "Failed to load account" }, { status: 500 }) }
  }
  if (!data.user) return { response: NextResponse.json({ error: "Account not found" }, { status: 404 }) }
  return { user: data.user }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await params
    const account = await getAccount(auth.service, id)
    if (account.response) return account.response
    return NextResponse.json(
      { email: account.user.email ?? null, emailConfirmed: !!account.user.email_confirmed_at },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    logError("Account management unavailable", error, { component: "admin/users/account", action: "GET" })
    return NextResponse.json({ error: "Account management is unavailable" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response

    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 })
    }
    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }
    if (typeof payload !== "object" || payload === null || !("action" in payload) ||
        (payload.action !== "reset-password" && payload.action !== "resend-confirmation" && payload.action !== "confirm-email")) {
      return NextResponse.json({ error: "Invalid account action" }, { status: 400 })
    }
    if (payload.action === "reset-password" &&
        (!("password" in payload) || typeof payload.password !== "string" || payload.password.length < 8)) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const { id } = await params
    const account = await getAccount(auth.service, id)
    if (account.response) return account.response

    if (payload.action === "resend-confirmation" || payload.action === "confirm-email") {
      if (account.user.email_confirmed_at) {
        return NextResponse.json({ error: "This account's email is already confirmed" }, { status: 409 })
      }
      if (!account.user.email) {
        return NextResponse.json({ error: "This account has no email address" }, { status: 400 })
      }
      if (payload.action === "confirm-email") {
        const { error } = await auth.service.auth.admin.updateUserById(id, { email_confirm: true })
        if (error) {
          logError("Failed to confirm email", error, { component: "admin/users/account", action: "confirm", userId: id })
          return NextResponse.json({ error: "Could not confirm email. Please try again." }, { status: 400 })
        }
      } else {
        const { error } = await auth.supabase.auth.resend({ type: "signup", email: account.user.email })
        if (error) {
          logError("Failed to resend signup confirmation", error, { component: "admin/users/account", action: "resend", userId: id })
          return NextResponse.json({ error: "Could not send confirmation email. Please try again later." }, { status: 400 })
        }
      }
    } else if ("password" in payload && typeof payload.password === "string") {
      const { error } = await auth.service.auth.admin.updateUserById(id, { password: payload.password })
      if (error) {
        logError("Failed to reset password", error, { component: "admin/users/account", action: "reset", userId: id })
        return NextResponse.json({ error: "Could not reset password. Please try again." }, { status: 400 })
      }
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    logError("Account management failed", error, { component: "admin/users/account", action: "POST" })
    return NextResponse.json({ error: "Account management is unavailable" }, { status: 500 })
  }
}
