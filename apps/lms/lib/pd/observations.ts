import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  PdObservation,
  PdObservationCategory,
  PdObservationCriterion,
  PdObservationRating,
  PdObservationSection,
} from "./types"

export async function getObservation(supabase: SupabaseClient, observationId: string) {
  const { data, error } = await supabase.from("pd_observations").select("*").eq("id", observationId).maybeSingle()
  return { data: data as PdObservation | null, error }
}

export async function getObservations(supabase: SupabaseClient, yearId: number) {
  return supabase
    .from("pd_observations")
    .select("*")
    .eq("year_id", yearId)
    .order("observation_date", { ascending: false })
}

export async function getObservationForm(supabase: SupabaseClient) {
  const [categories, criteria] = await Promise.all([
    supabase.from("pd_obs_categories").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("pd_obs_criteria").select("*").eq("is_active", true).order("sort_order"),
  ])
  return {
    categories: (categories.data ?? []) as PdObservationCategory[],
    criteria: (criteria.data ?? []) as PdObservationCriterion[],
    error: categories.error || criteria.error,
  }
}

export async function getObservationSections(supabase: SupabaseClient, observationId: string) {
  const { data, error } = await supabase
    .from("pd_observation_sections")
    .select("*")
    .eq("observation_id", observationId)
  return { data: (data ?? []) as PdObservationSection[], error }
}

export async function getObservationRatings(supabase: SupabaseClient, observationId: string) {
  const { data, error } = await supabase
    .from("pd_observation_ratings")
    .select("*")
    .eq("observation_id", observationId)
  return { data: (data ?? []) as PdObservationRating[], error }
}
