"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { createCourseSlug } from "@/lib/slug"
import { observationNames, observationPermissions } from "@/lib/pd/observation-ui"
import { readAll, sumHours } from "@/lib/pd/report-utils"
import type { PdAcademicYear, PdGoal, PdObservation, PdUserType } from "@/lib/pd/types"

const statusNames = { not_started: "Not started", on_track: "On track", needs_support: "Needs support", complete: "Complete" } as const

export default function PdDashboardPage() {
  const supabase = useMemo(() => createClient(), [])
  const dashboard = useQuery({
    queryKey: ["pd", "dashboard"],
    queryFn: async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error(authError?.message ?? "Please sign in again.")
      const [year, profile, settings] = await Promise.all([
        supabase.from("pd_academic_years").select("*").eq("is_current", true).single<PdAcademicYear>(),
        supabase.from("profiles").select("user_type").eq("id", user.id).single<{ user_type: PdUserType }>(),
        supabase.from("pd_settings").select("annual_cpd_target_hours").eq("id", 1).single<{ annual_cpd_target_hours: number }>(),
      ])
      if (year.error || profile.error || settings.error) throw new Error((year.error || profile.error || settings.error)!.message)
      const [goals, cpd, observations] = await Promise.all([
        supabase.from("pd_goals").select("*").eq("user_id", user.id).eq("year_id", year.data.id).order("target_date").returns<PdGoal[]>(),
        readAll<{ hours: number }>((from, to) => supabase.from("pd_cpd_activities").select("hours").eq("user_id", user.id).eq("year_id", year.data.id).order("id").range(from, to)),
        supabase.from("pd_observations").select("*").eq("year_id", year.data.id).eq("status", "published").or(`teacher_id.eq.${user.id},observer_id.eq.${user.id}`).order("observation_date", { ascending: false }).returns<PdObservation[]>(),
      ])
      if (goals.error || observations.error) throw new Error((goals.error || observations.error)!.message)
      return { user, role: profile.data.user_type, year: year.data, target: Number(settings.data.annual_cpd_target_hours), goals: goals.data, hours: sumHours(cpd), observations: observations.data }
    },
  })
  const training = useQuery({
    queryKey: ["pd", "dashboard-training"],
    queryFn: async () => {
      const response = await fetch("/api/enrollments")
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? "Unable to load Training.")
      return (result.enrollments as { id: string; course_id: number; status: string; progress: number | null; courses: { title: string } | null }[]).filter((item) => item.status === "active" && item.courses)
    },
  })
  const data = dashboard.data
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const upcoming = data?.goals.filter((goal) => goal.status !== "complete" && goal.target_date && goal.target_date >= localDate) ?? []
  const actions = data?.observations.filter((item) => {
    const permissions = observationPermissions(item, data.user.id, data.role)
    return (permissions.canRespond && !item.teacher_acknowledged_at) || permissions.canSign
  }) ?? []
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-primary">Professional Development</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">My PD</h1></div>
      {data && <Button asChild variant="outline"><a href={`/api/pd/portfolio?userId=${encodeURIComponent(data.user.id)}&yearId=${data.year.id}`}>Download my year portfolio</a></Button>}</div>
    {dashboard.isPending && <p>Loading your dashboard...</p>}
    {dashboard.error && <p role="alert" className="text-destructive">{dashboard.error.message}</p>}
    {data && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardHeader><CardTitle className="text-base">My goals</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{data.goals.length ? data.goals.map((goal) => <p key={goal.id}>{goal.title} · {statusNames[goal.status]}</p>) : <p>No goals yet.</p>}<Link className="underline" href="/pd/goals">View goals</Link></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">CPD hours</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{data.hours} of {data.target} hours</p><Progress value={data.target > 0 ? Math.min(100, data.hours / data.target * 100) : 0} /><Link className="underline" href="/pd/cpd">View CPD log</Link></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Observations needing action</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{actions.length ? actions.map((item) => <p key={item.id}><Link className="underline" href={`/pd/observations/${item.id}`}>{observationNames[item.form_type]} · {item.observation_date}</Link></p>) : <p>Nothing needs your attention.</p>}<Link className="underline" href="/pd/observations">View observations</Link></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Upcoming targets</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{upcoming.length ? upcoming.map((goal) => <p key={goal.id}>{goal.title} · {goal.target_date}</p>) : <p>No upcoming target dates.</p>}<Link className="underline" href="/pd/goals">View goals</Link></CardContent></Card>
    </div>}
    <Card><CardHeader><CardTitle className="text-base">Continue Training</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      {training.isPending && <p>Loading Training...</p>}{training.error && <p role="alert" className="text-destructive">{training.error.message}</p>}
      {training.data?.length === 0 && <p>No courses in progress.</p>}
      {training.data?.map((item) => <p key={item.id}><Link className="underline" href={`/learner/courses/${createCourseSlug(item.courses!.title, item.course_id)}/learn`}>{item.courses!.title}</Link> · {item.progress ?? 0}%</p>)}
    </CardContent></Card>
  </div>
}
