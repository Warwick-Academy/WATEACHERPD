import type { SupabaseClient } from "@supabase/supabase-js"
import type { PdCriteriaTrend, PdStaffYearSummary } from "./types"

export async function getStaffYearSummary(supabase: SupabaseClient, yearId: number) {
  const { data, error } = await supabase
    .from("pd_v_staff_year_summary")
    .select("*")
    .eq("year_id", yearId)
  return { data: (data ?? []) as PdStaffYearSummary[], error }
}

export async function getCriteriaTrends(supabase: SupabaseClient, yearId: number) {
  const { data, error } = await supabase
    .from("pd_v_criteria_trends")
    .select("*")
    .eq("year_id", yearId)
  return { data: (data ?? []) as PdCriteriaTrend[], error }
}
