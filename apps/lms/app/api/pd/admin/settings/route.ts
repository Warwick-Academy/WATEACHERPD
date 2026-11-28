import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const [{ data: profile }, { data: year }, { data: settings }] = await Promise.all([
    supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle(),
    supabase.from("pd_academic_years").select("*").eq("is_current", true).maybeSingle(),
    supabase.from("pd_settings").select("*").eq("id", 1).maybeSingle(),
  ])
  if (profile?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  return NextResponse.json({ year, settings })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data: profile } = await supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (profile?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const target = Number(body.annual_cpd_target_hours)
  const maxGoals = Number(body.max_goals_per_year)
  if (!Number.isFinite(target) || target <= 0 || !Number.isInteger(maxGoals) || maxGoals < 1 || maxGoals > 10) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 })
  }
  const { data, error } = await supabase
    .from("pd_settings")
    .update({ annual_cpd_target_hours: target, max_goals_per_year: maxGoals })
    .eq("id", 1)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ settings: data })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data: profile } = await supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (profile?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const { data, error } = await supabase.rpc("pd_start_new_year", {
    p_name: body.name,
    p_start: body.start_date,
    p_end: body.end_date,
    p_copy_assignments: Boolean(body.copy_assignments),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ yearId: data })
}
