import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data: caller } = await supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (caller?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: year } = await supabase.rpc("pd_current_year_id")
  if (!year) return NextResponse.json({ yearId: null, assignments: [] })
  const { data, error } = await supabase
    .from("pd_feedback_assignments")
    .select("id,year_id,staff_id,leader_id,is_lead")
    .eq("year_id", year)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ yearId: year, assignments: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data: caller } = await supabase.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (caller?.user_type !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await request.json()
  const { data: year } = await supabase.rpc("pd_current_year_id")
  if (!year) return NextResponse.json({ error: "No current academic year" }, { status: 400 })

  if (body.action === "assign") {
    const staffIds = Array.isArray(body.staffIds) ? body.staffIds : []
    if (!staffIds.length || !body.leaderId) return NextResponse.json({ error: "Select staff and a Feedback Leader" }, { status: 400 })
    const rows = [...new Set<string>(staffIds as string[])].map((staffId) => ({
      year_id: year,
      staff_id: staffId,
      leader_id: body.leaderId,
      is_lead: Boolean(body.isLead),
    }))
    if (body.isLead) {
      await supabase.from("pd_feedback_assignments").update({ is_lead: false }).eq("year_id", year).in("staff_id", staffIds)
    }
    const { error } = await supabase.from("pd_feedback_assignments").upsert(rows, { onConflict: "year_id,staff_id,leader_id" })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ assigned: rows.length })
  }

  if (body.action === "remove") {
    if (!body.staffId || !body.leaderId) return NextResponse.json({ error: "Invalid assignment" }, { status: 400 })
    const { error } = await supabase
      .from("pd_feedback_assignments")
      .delete()
      .eq("year_id", year)
      .eq("staff_id", body.staffId)
      .eq("leader_id", body.leaderId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ removed: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
