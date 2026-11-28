"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import type { PdAcademicYear, PdPhase, PdUserType } from "./types"

export type ObservationPerson = { id: string; name: string; phase: PdPhase; is_active: boolean }
export type ObservationViewer = ObservationPerson & { user_type: PdUserType }

export function useObservationContext() {
  const supabase = useMemo(() => createClient(), [])
  const context = useQuery({
    queryKey: ["pd", "observation-context"],
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) throw new Error(error?.message ?? "Please sign in again.")
      const [profile, year, people] = await Promise.all([
        supabase.from("profiles").select("id,name,phase,is_active,user_type").eq("id", user.id).single<ObservationViewer>(),
        supabase.from("pd_academic_years").select("*").eq("is_current", true).single<PdAcademicYear>(),
        supabase.from("profiles").select("id,name,phase,is_active").order("name").returns<ObservationPerson[]>(),
      ])
      if (profile.error) throw new Error(profile.error.message)
      if (year.error) throw new Error(year.error.message)
      if (people.error) throw new Error(people.error.message)
      const assignments = await supabase.from("pd_feedback_assignments").select("staff_id").eq("year_id", year.data.id).eq("leader_id", user.id)
      if (assignments.error) throw new Error(assignments.error.message)
      return { viewer: profile.data, year: year.data, people: people.data, ledStaffIds: assignments.data.map((item) => item.staff_id) }
    },
  })
  return { supabase, context }
}
