import type { SupabaseClient } from "@supabase/supabase-js"
import type { PdFeedbackAssignment, PdProfile } from "./types"

export async function getStaffDirectory(supabase: SupabaseClient, activeOnly = false) {
  let query = supabase.from("profiles").select("*").order("name")
  if (activeOnly) query = query.eq("is_active", true)
  const { data, error } = await query
  return { data: (data ?? []) as PdProfile[], error }
}

export async function getStaffProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
  return { data: data as PdProfile | null, error }
}

export async function getFeedbackAssignments(supabase: SupabaseClient, yearId: number) {
  const { data, error } = await supabase
    .from("pd_feedback_assignments")
    .select("*")
    .eq("year_id", yearId)
  return { data: (data ?? []) as PdFeedbackAssignment[], error }
}
