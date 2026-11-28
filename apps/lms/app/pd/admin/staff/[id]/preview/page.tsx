"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { activityNames } from "@/app/pd/cpd/cpd-editor"
import { observationNames, observationPermissions } from "@/lib/pd/observation-ui"
import { sumHours } from "@/lib/pd/report-utils"
import { getStaffPreview } from "@/lib/pd/staff-preview"
import { createClient } from "@/lib/supabase/client"
import type { PdGoalStatus } from "@/lib/pd/types"

const statuses: Record<PdGoalStatus, string> = { not_started: "Not started", on_track: "On track", needs_support: "Needs support", complete: "Complete" }

export default function StaffPreviewPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const preview = useQuery({
    queryKey: ["pd", "staff-preview", id],
    queryFn: () => getStaffPreview(supabase, id),
    staleTime: 0,
    gcTime: 0,
  })
  const data = preview.data
  const hours = sumHours(data?.cpd ?? [])
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const upcoming = data?.goals.filter((goal) => goal.status !== "complete" && goal.target_date && goal.target_date >= localDate) ?? []
  const actions = data?.observations.filter((item) => {
    const permissions = observationPermissions(item, data.person.id, data.person.user_type)
    return (permissions.canRespond && !item.teacher_acknowledged_at) || permissions.canSign
  }) ?? []

  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <div className="rounded-md border border-amber-500 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100" role="status">
      <p className="font-semibold">Read-only account preview{data ? `: ${data.person.name}` : ""}</p>
      <p className="mt-1 text-sm">You remain signed in as yourself. This is a current-year summary using your administrator access, not an exact simulation of the user’s permissions. Private drafts are excluded; no actions can be taken as this user.</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Account preview</h1>{data && <p className="text-sm text-muted-foreground">{data.person.name} · {data.person.user_type} · {data.year.name}{!data.person.is_active ? " · Inactive" : ""}</p>}</div><Button asChild variant="outline"><Link href="/pd/admin/staff">Exit preview</Link></Button></div>
    {preview.isPending && <p>Loading preview...</p>}
    {preview.error && <p role="alert" className="text-destructive">{preview.error.message}</p>}
    {data && <Tabs defaultValue="dashboard" className="space-y-4">
      <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
        <TabsTrigger value="dashboard">My PD</TabsTrigger><TabsTrigger value="goals">My Goals</TabsTrigger><TabsTrigger value="observations">Observations</TabsTrigger><TabsTrigger value="cpd">CPD Log</TabsTrigger><TabsTrigger value="training">Training</TabsTrigger>
        {!!data.team.length && <TabsTrigger value="team">My Team</TabsTrigger>}
      </TabsList>
      <TabsContent value="dashboard" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader><CardTitle className="text-base">My goals</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{data.goals.length ? data.goals.map((goal) => <p key={goal.id}>{goal.title} · {statuses[goal.status]}</p>) : <p>No goals yet.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">CPD hours</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{hours} of {data.target} hours</p><Progress value={data.target > 0 ? Math.min(100, hours / data.target * 100) : 0} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Observations needing action</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{actions.length ? actions.map((item) => <p key={item.id}>{observationNames[item.form_type]} · {item.observation_date}</p>) : <p>Nothing needs attention.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Upcoming targets</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{upcoming.length ? upcoming.map((goal) => <p key={goal.id}>{goal.title} · {goal.target_date}</p>) : <p>No upcoming target dates.</p>}</CardContent></Card>
      </TabsContent>
      <TabsContent value="goals" className="space-y-3">
        {!data.goals.length && <p>No goals in this academic year.</p>}
        {data.goals.map((goal) => <Card key={goal.id}><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2">{goal.title}<Badge variant="secondary">{statuses[goal.status]}</Badge></CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p className="whitespace-pre-wrap">{goal.smart_description}</p>{goal.action_plan && <p className="whitespace-pre-wrap"><strong>Action plan:</strong> {goal.action_plan}</p>}{goal.support_required && <p className="whitespace-pre-wrap"><strong>Support required:</strong> {goal.support_required}</p>}{goal.target_date && <p>Target date: {goal.target_date}</p>}</CardContent></Card>)}
      </TabsContent>
      <TabsContent value="observations" className="space-y-3">
        {!data.observations.length && <p>No published observations in this academic year.</p>}
        {[...data.observations].sort((a, b) => b.observation_date.localeCompare(a.observation_date)).map((item) => <Card key={item.id}><CardHeader><CardTitle className="text-base">{observationNames[item.form_type]} · {item.observation_date}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>{item.teacher_id === data.person.id ? "About this staff member" : "Written by this staff member"} · {item.status}</p>{item.comment && <p className="whitespace-pre-wrap"><strong>Comment:</strong> {item.comment}</p>}{item.overall_comment && <p className="whitespace-pre-wrap"><strong>Overall comment:</strong> {item.overall_comment}</p>}{item.teacher_response && <p className="whitespace-pre-wrap"><strong>Teacher response:</strong> {item.teacher_response}</p>}</CardContent></Card>)}
      </TabsContent>
      <TabsContent value="cpd" className="space-y-3">
        <p>{hours} of {data.target} hours</p>
        {!data.cpd.length && <p>No CPD entries in this academic year.</p>}
        {data.cpd.map((item) => <Card key={item.id}><CardContent className="space-y-2 pt-6 text-sm"><p className="font-semibold">{item.title} · {item.hours} hours</p><p>{item.activity_date} · {activityNames[item.activity_type]}{item.provider ? ` · ${item.provider}` : ""}</p>{item.description && <p className="whitespace-pre-wrap">{item.description}</p>}{item.impact_reflection && <p className="whitespace-pre-wrap"><strong>Teaching impact:</strong> {item.impact_reflection}</p>}{item.evidence_name && <p>Evidence attached: {item.evidence_name}</p>}</CardContent></Card>)}
      </TabsContent>
      <TabsContent value="training" className="space-y-3">
        {!data.enrollments.length && <p>No active or completed Training enrolments.</p>}
        {data.enrollments.map((entry) => <Card key={entry.id}><CardContent className="pt-6 text-sm"><p className="font-semibold">{data.courses.find((course) => course.id === entry.course_id)?.title ?? `Course ${entry.course_id}`}</p><p>{entry.status} · {entry.progress ?? 0}% complete</p></CardContent></Card>)}
      </TabsContent>
      <TabsContent value="team" className="grid gap-4 sm:grid-cols-2">
        {data.team.map((person) => {
          const goals = data.teamGoals.filter((goal) => goal.user_id === person.id)
          const observations = data.teamObservations.filter((item) => item.teacher_id === person.id).sort((a, b) => b.observation_date.localeCompare(a.observation_date))
          return <Card key={person.id}><CardHeader><CardTitle className="text-base">{person.name}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><p>Goals: {goals.length ? goals.map((goal) => statuses[goal.status]).join(", ") : "None"}</p><p>Last observation: {observations[0]?.observation_date ?? "None"}</p><p>CPD: {sumHours(data.teamCpd.filter((item) => item.user_id === person.id))} of {data.target} hours</p><p>Appraisal: {observations.find((item) => item.form_type === "appraisal")?.status ?? "None"}</p></CardContent></Card>
        })}
      </TabsContent>
    </Tabs>}
  </div>
}
