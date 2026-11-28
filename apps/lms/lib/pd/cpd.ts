import type { SupabaseClient } from "@supabase/supabase-js"
import type { PdCpdActivity } from "./types"

export async function getCpdActivities(supabase: SupabaseClient, userId: string, yearId: number) {
  const { data, error } = await supabase
    .from("pd_cpd_activities")
    .select("*")
    .eq("user_id", userId)
    .eq("year_id", yearId)
    .order("activity_date", { ascending: false })
  return { data: (data ?? []) as PdCpdActivity[], error }
}

export async function getCpdSignedUrl(supabase: SupabaseClient, path: string) {
  return supabase.storage.from("pd-evidence").createSignedUrl(path, 60 * 30)
}

export async function uploadCpdEvidence(supabase: SupabaseClient, path: string, file: File) {
  return supabase.storage.from("pd-evidence").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  })
}
