import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: caller } = await supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (caller?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return NextResponse.json({ error: "No staff rows supplied" }, { status: 400 })

  let service
  try {
    service = createServiceRoleClient()
  } catch {
    return NextResponse.json({ error: "User creation is not configured on this server" }, { status: 500 })
  }

  const results: { name: string; email: string; status: string; password?: string }[] = []
  for (const raw of rows.slice(0, 500)) {
    const name = String(raw.name ?? "").trim()
    const email = String(raw.email ?? "").trim().toLowerCase()
    const job_title = String(raw.job_title ?? "").trim() || null
    const department = String(raw.department ?? "").trim() || null
    const phase = ["primary", "secondary", "both"].includes(raw.phase) ? raw.phase : "secondary"
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !email.endsWith("@warwick.bm")) {
      results.push({ name, email, status: "Skipped: invalid staff details or email" })
      continue
    }

    const password = `Wa1!${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
    const { data: authUser, error: authError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    })
    if (authError || !authUser.user) {
      results.push({ name, email, status: authError?.code === "email_exists" ? "Skipped: account already exists" : "Skipped: account creation failed" })
      continue
    }

    const { error: profileError } = await service
      .from("profiles")
      .update({ name, job_title, department, phase, user_type: "user", is_active: true })
      .eq("id", authUser.user.id)
    results.push({
      name,
      email,
      password,
      status: profileError ? "Account created; profile update failed" : "Created",
    })
  }
  return NextResponse.json({ results })
}
