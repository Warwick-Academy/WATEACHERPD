"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { PdAcademicYear, PdProfile } from "./types"
import type { PdContext } from "./context"

export function usePdContext(): PdContext & { loading: boolean } {
  const [context, setContext] = useState<PdContext & { loading: boolean }>({
    profile: null,
    isAdmin: false,
    isLeadership: false,
    canViewAll: false,
    currentYear: null,
    ledStaffIds: [],
    isFeedbackLeader: false,
    loading: true,
  })

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) setContext((value) => ({ ...value, loading: false }))
        return
      }

      const [{ data: profile }, { data: currentYear }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("pd_academic_years").select("*").eq("is_current", true).maybeSingle(),
      ])
      const { data: yearId } = await supabase.rpc("pd_current_year_id")
      const { data: assignments } = yearId
        ? await supabase.from("pd_feedback_assignments").select("staff_id").eq("leader_id", user.id).eq("year_id", yearId)
        : { data: null }

      if (cancelled) return

      const pdProfile = profile as PdProfile | null
      const isAdmin = pdProfile?.user_type === "admin"
      const isLeadership = pdProfile?.user_type === "leadership"
      const ledStaffIds = [...new Set((assignments ?? []).map((item: { staff_id: string }) => item.staff_id))]
      setContext({
        profile: pdProfile,
        isAdmin,
        isLeadership,
        canViewAll: isAdmin || isLeadership,
        currentYear: currentYear as PdAcademicYear | null,
        ledStaffIds,
        isFeedbackLeader: ledStaffIds.length > 0,
        loading: false,
      })
    }

    load()
    return () => { cancelled = true }
  }, [])

  return context
}
