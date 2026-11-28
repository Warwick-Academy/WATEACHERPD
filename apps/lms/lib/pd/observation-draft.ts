import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { PdAcademicYear, PdObservation, PdObservationCategory, PdObservationCriterion } from "./types"

export const observationDraftSchema = z.object({
  observation_date: z.string().date(),
  year_group: z.string().max(100),
  subject: z.string().max(100),
  comment: z.string().max(5000),
  overall_comment: z.string().max(5000),
  overall_rating: z.union([z.literal(""), z.enum(["exceeding", "meeting", "almost_meeting", "not_meeting"])]),
  sections: z.record(z.object({ evidence_comment: z.string().max(5000), reflection_questions: z.string().max(5000) })),
  ratings: z.record(z.union([z.literal(""), z.enum(["always_mostly", "sometimes", "no", "na"])])),
})
export type ObservationDraftValues = z.infer<typeof observationDraftSchema>

export async function saveObservationDraft({
  supabase, observation, viewerId, year, categories, criteria, values,
}: {
  supabase: SupabaseClient
  observation: PdObservation
  viewerId: string
  year: PdAcademicYear
  categories: PdObservationCategory[]
  criteria: PdObservationCriterion[]
  values: ObservationDraftValues
}) {
  if (values.observation_date < year.start_date || values.observation_date > year.end_date) {
    throw new Error("The observation date must be in the current academic year.")
  }
  const header = await supabase.from("pd_observations").update({
    observation_date: values.observation_date, year_group: values.year_group.trim() || null,
    subject: values.subject.trim() || null, comment: values.comment.trim() || null,
    overall_comment: values.overall_comment.trim() || null,
    overall_rating: observation.form_type === "appraisal" ? values.overall_rating || null : null,
  }).eq("id", observation.id).eq("status", "draft").eq("observer_id", viewerId).select("id").single()
  if (header.error) throw new Error(header.error.message)

  if (observation.form_type !== "learning_walk" && categories.length) {
    const sections = categories.map((category) => ({
      observation_id: observation.id, category_id: category.id,
      evidence_comment: values.sections[String(category.id)]?.evidence_comment.trim() || null,
      reflection_questions: observation.form_type === "self_reflection" ? null : values.sections[String(category.id)]?.reflection_questions.trim() || null,
    }))
    const result = await supabase.from("pd_observation_sections").upsert(sections, { onConflict: "observation_id,category_id" })
    if (result.error) throw new Error(result.error.message)
  }

  if (observation.form_type === "appraisal" || observation.form_type === "self_reflection") {
    const selected = criteria.flatMap((criterion) => {
      const rating = values.ratings[String(criterion.id)]
      return rating ? [{ observation_id: observation.id, criterion_id: criterion.id, rating }] : []
    })
    const cleared = criteria.filter((criterion) => !values.ratings[String(criterion.id)]).map((criterion) => criterion.id)
    if (selected.length) {
      const result = await supabase.from("pd_observation_ratings").upsert(selected, { onConflict: "observation_id,criterion_id" })
      if (result.error) throw new Error(result.error.message)
    }
    if (cleared.length) {
      const result = await supabase.from("pd_observation_ratings").delete().eq("observation_id", observation.id).in("criterion_id", cleared)
      if (result.error) throw new Error(result.error.message)
    }
  }
}
