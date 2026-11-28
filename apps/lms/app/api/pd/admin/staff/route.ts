import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (profile?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data, error } = await supabase
    .from("profiles")
    .select("id,name,email,user_type,job_title,department,phase,is_active,pd_email_reminders")
    .order("name")
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ staff: data ?? [] })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (profile?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const allowedPhase = ["primary", "secondary", "both"].includes(body.phase)
  const allowedRole = ["user", "admin", "instructor", "leadership"].includes(body.user_type)
  if (!body.id || !allowedPhase || !allowedRole) {
    return NextResponse.json({ error: "Invalid staff details" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({
      name: String(body.name ?? "").trim(),
      job_title: body.job_title?.trim() || null,
      department: body.department?.trim() || null,
      phase: body.phase,
      user_type: body.user_type,
      is_active: Boolean(body.is_active),
      pd_email_reminders: Boolean(body.pd_email_reminders),
    })
    .eq("id", body.id)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ staff: data })
}
