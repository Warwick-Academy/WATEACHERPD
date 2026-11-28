import type { SupabaseClient } from "@supabase/supabase-js"
import type { PdAcademicYear, PdSettings } from "./types"

export async function getAcademicYears(supabase: SupabaseClient) {
  return supabase.from("pd_academic_years").select("*").order("start_date", { ascending: false })
}

export async function getCurrentAcademicYear(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("pd_academic_years")
    .select("*")
    .eq("is_current", true)
    .maybeSingle()
  return { data: data as PdAcademicYear | null, error }
}

export async function getPdSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("pd_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle()
  return { data: data as PdSettings | null, error }
}
