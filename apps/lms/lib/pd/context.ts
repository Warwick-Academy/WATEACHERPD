import type { PdAcademicYear, PdProfile } from "./types"

export interface PdContext {
  profile: PdProfile | null
  isAdmin: boolean
  isLeadership: boolean
  canViewAll: boolean
  currentYear: PdAcademicYear | null
  ledStaffIds: string[]
  isFeedbackLeader: boolean
}

export async function getPdContext(): Promise<PdContext> {
  const { createClient } = await import("@/lib/supabase/server")
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      profile: null,
      isAdmin: false,
      isLeadership: false,
      canViewAll: false,
      currentYear: null,
      ledStaffIds: [],
      isFeedbackLeader: false,
    }
  }

  const [{ data: profile }, { data: currentYear }, { data: assignments }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("pd_academic_years").select("*").eq("is_current", true).maybeSingle(),
    supabase.rpc("pd_current_year_id").then(async ({ data: yearId }) =>
      yearId
        ? supabase.from("pd_feedback_assignments").select("staff_id").eq("leader_id", user.id).eq("year_id", yearId)
        : { data: null, error: null }
    ),
  ])

  const pdProfile = profile as PdProfile | null
  const isAdmin = pdProfile?.user_type === "admin"
  const isLeadership = pdProfile?.user_type === "leadership"
  const ledStaffIds = [...new Set((assignments ?? []).map((item: { staff_id: string }) => item.staff_id))]

  return {
    profile: pdProfile,
    isAdmin,
    isLeadership,
    canViewAll: isAdmin || isLeadership,
    currentYear: currentYear as PdAcademicYear | null,
    ledStaffIds,
    isFeedbackLeader: ledStaffIds.length > 0,
  }
}
