import type { SupabaseClient } from "@supabase/supabase-js"
import type { PdGoal, PdGoalUpdate, PdSchoolGoal } from "./types"

export async function getGoals(supabase: SupabaseClient, userId: string, yearId: number) {
  return supabase.from("pd_goals").select("*").eq("user_id", userId).eq("year_id", yearId).order("created_at")
}

export async function getGoal(supabase: SupabaseClient, goalId: string) {
  const { data, error } = await supabase.from("pd_goals").select("*").eq("id", goalId).maybeSingle()
  return { data: data as PdGoal | null, error }
}

export async function getGoalUpdates(supabase: SupabaseClient, goalId: string) {
  const { data, error } = await supabase
    .from("pd_goal_updates")
    .select("*")
    .eq("goal_id", goalId)
    .order("created_at", { ascending: false })
  return { data: (data ?? []) as PdGoalUpdate[], error }
}

export async function getSchoolGoals(supabase: SupabaseClient, yearId: number) {
  const { data, error } = await supabase
    .from("pd_school_goals")
    .select("*")
    .eq("year_id", yearId)
    .order("sort_order")
  return { data: (data ?? []) as PdSchoolGoal[], error }
}
