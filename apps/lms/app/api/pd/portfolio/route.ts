import fs from "node:fs"
import path from "node:path"
import "@/lib/certificates/pdfkit-font-patch"
import PDFDocument from "pdfkit"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logError } from "@/lib/utils/errorHandler"
import { observationNames } from "@/lib/pd/observation-ui"
import { readAll, sumHours } from "@/lib/pd/report-utils"
import type { PdAcademicYear, PdCpdActivity, PdGoal, PdGoalUpdate, PdObservation, PdObservationCategory, PdObservationCriterion, PdObservationRating, PdObservationSection, PdUserType } from "@/lib/pd/types"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const userId = url.searchParams.get("userId") ?? ""
  const yearId = Number(url.searchParams.get("yearId"))
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || !Number.isSafeInteger(yearId) || yearId <= 0) {
    return NextResponse.json({ error: "Select a valid staff member and academic year." }, { status: 400 })
  }
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 })
    const [viewer, year, person] = await Promise.all([
      supabase.from("profiles").select("user_type").eq("id", user.id).single<{ user_type: PdUserType }>(),
      supabase.from("pd_academic_years").select("*").eq("id", yearId).single<PdAcademicYear>(),
      supabase.from("profiles").select("id,name").eq("id", userId).single<{ id: string; name: string }>(),
    ])
    if (viewer.error || year.error || person.error) throw new Error((viewer.error || year.error || person.error)!.message)
    if (user.id !== userId && !["admin", "leadership"].includes(viewer.data.user_type)) {
      const assignment = await supabase.from("pd_feedback_assignments").select("id").eq("year_id", yearId).eq("leader_id", user.id).eq("staff_id", userId).maybeSingle()
      if (assignment.error) throw new Error(assignment.error.message)
      if (!assignment.data) return NextResponse.json({ error: "You cannot view this portfolio." }, { status: 403 })
    }
    const [goals, observations, cpd, categories, criteria, people] = await Promise.all([
      readAll<PdGoal>((from, to) => supabase.from("pd_goals").select("*").eq("user_id", userId).eq("year_id", yearId).order("id").range(from, to)),
      readAll<PdObservation>((from, to) => supabase.from("pd_observations").select("*").eq("teacher_id", userId).eq("year_id", yearId).neq("status", "draft").order("id").range(from, to)),
      readAll<PdCpdActivity>((from, to) => supabase.from("pd_cpd_activities").select("*").eq("user_id", userId).eq("year_id", yearId).order("id").range(from, to)),
      readAll<PdObservationCategory>((from, to) => supabase.from("pd_obs_categories").select("*").order("id").range(from, to)),
      readAll<PdObservationCriterion>((from, to) => supabase.from("pd_obs_criteria").select("*").order("id").range(from, to)),
      readAll<{ id: string; name: string }>((from, to) => supabase.from("profiles").select("id,name").order("id").range(from, to)),
    ])
    const goalIds = goals.map((g) => g.id)
    const observationIds = observations.map((o) => o.id)
    const [updates, sections, ratings] = await Promise.all([
      goalIds.length ? readAll<PdGoalUpdate>((from, to) => supabase.from("pd_goal_updates").select("*").in("goal_id", goalIds).order("id").range(from, to)) : Promise.resolve([]),
      observationIds.length ? readAll<PdObservationSection>((from, to) => supabase.from("pd_observation_sections").select("*").in("observation_id", observationIds).order("observation_id").order("category_id").range(from, to)) : Promise.resolve([]),
      observationIds.length ? readAll<PdObservationRating>((from, to) => supabase.from("pd_observation_ratings").select("*").in("observation_id", observationIds).order("observation_id").order("criterion_id").range(from, to)) : Promise.resolve([]),
    ])
    const crest = [path.join(process.cwd(), "public", "brand", "crest-transparent.png"), path.join(process.cwd(), "apps", "lms", "public", "brand", "crest-transparent.png")].find((candidate) => fs.existsSync(candidate))
    if (!crest) throw new Error("The Warwick Academy crest is unavailable.")
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Professional development portfolio - ${person.data.name}` } })
    const chunks: Buffer[] = []
    const output = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => chunks.push(chunk))
      doc.on("end", () => resolve(Buffer.concat(chunks)))
      doc.on("error", reject)
    })
    const heading = (text: string) => { doc.moveDown().font("Helvetica-Bold").fontSize(15).fillColor("#17375e").text(text).fillColor("black").fontSize(10).font("Helvetica") }
    const text = (label: string, value: string | null | undefined) => { if (value) doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(value) }
    const name = (id: string) => people.find((p) => p.id === id)?.name ?? "Staff member"
    doc.image(crest, 50, 45, { fit: [54, 54] })
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#17375e").text("Warwick Academy", 120, 55).fontSize(13).text("Professional development portfolio")
    doc.fillColor("black").fontSize(10).font("Helvetica").text(`${person.data.name} | ${year.data.name}`, 120, 100)
    doc.y = 125
    heading("Goals and updates")
    if (!goals.length) doc.text("No goals recorded.")
    for (const goal of goals) {
      doc.moveDown(0.5).font("Helvetica-Bold").text(goal.title).font("Helvetica")
      text("Status", goal.status.replace(/_/g, " ")); text("SMART goal", goal.smart_description)
      text("Action plan", goal.action_plan); text("Support required", goal.support_required); text("Target date", goal.target_date)
      for (const update of updates.filter((item) => item.goal_id === goal.id).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
        text(`Update ${update.created_at.slice(0, 10)} - ${name(update.author_id)}`, `${update.note}${update.status ? ` (status: ${update.status.replace(/_/g, " ")})` : ""}`)
      }
    }
    heading("Published observations")
    if (!observations.length) doc.text("No published observations.")
    for (const item of observations.sort((a, b) => a.observation_date.localeCompare(b.observation_date))) {
      doc.moveDown(0.5).font("Helvetica-Bold").text(`${observationNames[item.form_type]} - ${item.observation_date}`).font("Helvetica")
      text("Observer", name(item.observer_id)); text("Subject", item.subject); text("Year group", item.year_group)
      text("Comment", item.comment); text("Overall comment", item.overall_comment); text("Overall rating", item.overall_rating?.replace(/_/g, " "))
      text("Teacher response", item.teacher_response); text("Status", item.status); text("Teacher acknowledged", item.teacher_acknowledged_at)
      text("Observer signed", item.observer_signed_at); text("Teacher signed", item.teacher_signed_at)
      for (const category of categories) {
        const section = sections.find((s) => s.observation_id === item.id && s.category_id === category.id)
        const categoryRatings = ratings.filter((r) => r.observation_id === item.id && criteria.some((c) => c.id === r.criterion_id && c.category_id === category.id))
        if (!section && !categoryRatings.length) continue
        doc.moveDown(0.3).font("Helvetica-Bold").text(category.name).font("Helvetica")
        text("Evidence", section?.evidence_comment); text("Reflection questions", section?.reflection_questions); text("Teacher response", section?.teacher_response)
        for (const rating of categoryRatings) {
          text(criteria.find((c) => c.id === rating.criterion_id)?.label ?? "Criterion", rating.rating.replace(/_/g, " "))
        }
      }
    }
    heading("CPD log")
    doc.text(`Total: ${sumHours(cpd)} hours`)
    for (const item of cpd.sort((a, b) => a.activity_date.localeCompare(b.activity_date))) {
      doc.moveDown(0.5).font("Helvetica-Bold").text(`${item.activity_date} - ${item.title} - ${item.hours} hours`).font("Helvetica")
      text("Activity type", item.activity_type.replace(/_/g, " ")); text("Provider", item.provider); text("Description", item.description); text("Teaching impact", item.impact_reflection)
    }
    doc.end()
    const pdf = await output
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="pd-portfolio.pdf"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
  } catch (error) {
    logError("Unable to generate PD portfolio", error, { component: "pd/portfolio", userId, yearId })
    return NextResponse.json({ error: "Unable to generate the portfolio. Please try again." }, { status: 500 })
  }
}
