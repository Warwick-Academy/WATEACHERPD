import type { SupabaseClient } from "@supabase/supabase-js"
import { readAll } from "./report-utils"
import type { PdAcademicYear, PdCpdActivity, PdGoal, PdObservation, PdProfile } from "./types"

type PreviewPerson = Pick<PdProfile, "id" | "name" | "user_type" | "is_active">
type PreviewEnrollment = { id: string; course_id: number; status: string; progress: number | null }
type PreviewCourse = { id: number; title: string; pd_hours: number | string | null }
type TeamGoal = Pick<PdGoal, "id" | "user_id" | "status">
type TeamCpd = Pick<PdCpdActivity, "id" | "user_id" | "hours">
type TeamObservation = Pick<PdObservation, "id" | "teacher_id" | "observation_date" | "status" | "form_type">

export async function getStaffPreview(supabase: SupabaseClient, staffId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) throw new Error("Invalid staff member.")
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error(authError?.message ?? "Please sign in again.")
  const viewer = await supabase.from("profiles").select("user_type").eq("id", user.id).single<{ user_type: string }>()
  if (viewer.error) throw new Error(viewer.error.message)
  if (viewer.data.user_type !== "admin") throw new Error("Only administrators can view a staff preview.")

  const [person, year, settings] = await Promise.all([
    supabase.from("profiles").select("id,name,user_type,is_active").eq("id", staffId).single<PreviewPerson>(),
    supabase.from("pd_academic_years").select("*").eq("is_current", true).single<PdAcademicYear>(),
    supabase.from("pd_settings").select("annual_cpd_target_hours").eq("id", 1).single<{ annual_cpd_target_hours: number }>(),
  ])
  if (person.error || year.error || settings.error) throw new Error((person.error || year.error || settings.error)!.message)
  const yearId = year.data.id
  const [goals, cpd, observed, written, assignments, enrollments] = await Promise.all([
    readAll<PdGoal>((from, to) => supabase.from("pd_goals").select("*").eq("user_id", staffId).eq("year_id", yearId).order("id").range(from, to)),
    readAll<PdCpdActivity>((from, to) => supabase.from("pd_cpd_activities").select("*").eq("user_id", staffId).eq("year_id", yearId).order("id").range(from, to)),
    readAll<PdObservation>((from, to) => supabase.from("pd_observations").select("*").eq("teacher_id", staffId).eq("year_id", yearId).neq("status", "draft").order("id").range(from, to)),
    readAll<PdObservation>((from, to) => supabase.from("pd_observations").select("*").eq("observer_id", staffId).eq("year_id", yearId).neq("status", "draft").order("id").range(from, to)),
    readAll<{ staff_id: string }>((from, to) => supabase.from("pd_feedback_assignments").select("staff_id").eq("leader_id", staffId).eq("year_id", yearId).order("staff_id").range(from, to)),
    readAll<PreviewEnrollment>((from, to) => supabase.from("enrollments").select("id,course_id,status,progress").eq("user_id", staffId).neq("status", "cancelled").order("id").range(from, to)),
  ])
  const courseIds = [...new Set(enrollments.map((item) => item.course_id))]
  const adminTeam = person.data.user_type === "admin"
    ? await readAll<PreviewPerson>((from, to) => supabase.from("profiles").select("id,name,user_type,is_active").eq("is_active", true).neq("id", staffId).order("id").range(from, to))
    : null
  const staffIds = adminTeam ? adminTeam.map((member) => member.id) : [...new Set(assignments.map((assignment) => assignment.staff_id))]
  const [courses, team, teamGoals, teamCpd, teamObservations] = await Promise.all([
    courseIds.length ? readAll<PreviewCourse>((from, to) => supabase.from("courses").select("id,title,pd_hours").in("id", courseIds).order("id").range(from, to)) : Promise.resolve([]),
    adminTeam ? Promise.resolve(adminTeam) : staffIds.length ? readAll<PreviewPerson>((from, to) => supabase.from("profiles").select("id,name,user_type,is_active").in("id", staffIds).order("id").range(from, to)) : Promise.resolve([]),
    staffIds.length ? readAll<TeamGoal>((from, to) => supabase.from("pd_goals").select("id,user_id,status").eq("year_id", yearId).in("user_id", staffIds).order("id").range(from, to)) : Promise.resolve([]),
    staffIds.length ? readAll<TeamCpd>((from, to) => supabase.from("pd_cpd_activities").select("id,user_id,hours").eq("year_id", yearId).in("user_id", staffIds).order("id").range(from, to)) : Promise.resolve([]),
    staffIds.length ? readAll<TeamObservation>((from, to) => supabase.from("pd_observations").select("id,teacher_id,observation_date,status,form_type").eq("year_id", yearId).in("teacher_id", staffIds).neq("status", "draft").order("id").range(from, to)) : Promise.resolve([]),
  ])
  return {
    person: person.data, year: year.data, target: Number(settings.data.annual_cpd_target_hours),
    goals, cpd, observations: [...new Map([...observed, ...written].filter((item) => item.status !== "draft").map((item) => [item.id, item])).values()],
    enrollments, courses, team, teamGoals, teamCpd, teamObservations: teamObservations.filter((item) => item.status !== "draft"),
  }
}
