"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { getCpdSignedUrl } from "@/lib/pd/cpd"
import { observationNames } from "@/lib/pd/observation-ui"
import { readAll, sumHours } from "@/lib/pd/report-utils"
import { activityNames } from "@/app/pd/cpd/cpd-editor"
import type { PdAcademicYear, PdCpdActivity, PdGoal, PdGoalStatus, PdGoalUpdate, PdObservation, PdUserType } from "@/lib/pd/types"

type Person = { id: string; name: string; is_active: boolean }
const names: Record<PdGoalStatus, string> = { not_started: "Not started", on_track: "On track", needs_support: "Needs support", complete: "Complete" }
const colours: Record<PdGoalStatus, string> = { not_started: "bg-slate-400", on_track: "bg-blue-600", needs_support: "bg-amber-500", complete: "bg-green-600" }

export default function TeamPage() {
  const supabase = useMemo(() => createClient(), [])
  const cache = useQueryClient()
  const [selected, setSelected] = useState("")
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [evidenceError, setEvidenceError] = useState("")
  const data = useQuery({
    queryKey: ["pd", "team"],
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) throw new Error(error?.message ?? "Please sign in again.")
      const [profile, year, settings] = await Promise.all([
        supabase.from("profiles").select("user_type").eq("id", user.id).single<{ user_type: PdUserType }>(),
        supabase.from("pd_academic_years").select("*").eq("is_current", true).single<PdAcademicYear>(),
        supabase.from("pd_settings").select("annual_cpd_target_hours").eq("id", 1).single<{ annual_cpd_target_hours: number }>(),
      ])
      if (profile.error || year.error || settings.error) throw new Error((profile.error || year.error || settings.error)!.message)
      const assignments = await readAll<{ staff_id: string }>((from, to) => supabase.from("pd_feedback_assignments").select("staff_id").eq("leader_id", user.id).eq("year_id", year.data.id).order("staff_id").range(from, to))
      const people = await readAll<Person>((from, to) => supabase.from("profiles").select("id,name,is_active").order("id").range(from, to))
      const ids = profile.data.user_type === "admin" ? people.filter((p) => p.is_active && p.id !== user.id).map((p) => p.id) : assignments.map((a) => a.staff_id)
      const team = people.filter((person) => ids.includes(person.id)).sort((a, b) => a.name.localeCompare(b.name))
      if (!ids.length) return { user, role: profile.data.user_type, year: year.data, target: Number(settings.data.annual_cpd_target_hours), team, people, goals: [] as PdGoal[], updates: [] as PdGoalUpdate[], observations: [] as PdObservation[], cpd: [] as PdCpdActivity[] }
      const [goals, observations, cpd] = await Promise.all([
        readAll<PdGoal>((from, to) => supabase.from("pd_goals").select("*").eq("year_id", year.data.id).in("user_id", ids).order("id").range(from, to)),
        readAll<PdObservation>((from, to) => supabase.from("pd_observations").select("*").eq("year_id", year.data.id).in("teacher_id", ids).neq("status", "draft").order("id").range(from, to)),
        readAll<PdCpdActivity>((from, to) => supabase.from("pd_cpd_activities").select("*").eq("year_id", year.data.id).in("user_id", ids).order("id").range(from, to)),
      ])
      const goalIds = goals.map((goal) => goal.id)
      const updates = goalIds.length ? await readAll<PdGoalUpdate>((from, to) => supabase.from("pd_goal_updates").select("*").in("goal_id", goalIds).order("id").range(from, to)) : []
      return { user, role: profile.data.user_type, year: year.data, target: Number(settings.data.annual_cpd_target_hours), team, people, goals, updates, observations, cpd }
    },
  })
  const comment = useMutation({
    mutationFn: async ({ goal, note }: { goal: PdGoal; note: string }) => {
      if (!data.data || !data.data.team.some((person) => person.id === goal.user_id) || !note.trim()) throw new Error("Enter a comment for an assigned staff member.")
      const { error } = await supabase.from("pd_goal_updates").insert({ goal_id: goal.id, author_id: data.data.user.id, note: note.trim(), is_checkin: false })
      if (error) throw new Error(error.message)
      return goal.id
    },
    onSuccess: async (id) => { setNotes((current) => ({ ...current, [id]: "" })); await Promise.all([cache.invalidateQueries({ queryKey: ["pd", "goal-details"] }), cache.invalidateQueries({ queryKey: ["pd", "team"] })]) },
  })
  const info = data.data
  const person = info?.team.find((item) => item.id === selected)
  async function openEvidence(path: string) {
    setEvidenceError("")
    const tab = window.open("about:blank", "_blank")
    if (!tab) { setEvidenceError("Allow pop-ups to open evidence."); return }
    tab.opener = null
    try {
      const { data: result, error } = await getCpdSignedUrl(supabase, path)
      if (error || !result?.signedUrl) throw new Error(error?.message ?? "Unable to open evidence.")
      tab.location.href = result.signedUrl
    } catch (error) {
      tab.close()
      setEvidenceError(error instanceof Error ? error.message : "Unable to open evidence.")
    }
  }
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <h1 className="text-2xl font-semibold">My Team</h1>
    {data.isPending && <p>Loading team...</p>}{data.error && <p role="alert" className="text-destructive">{data.error.message}</p>}
    {info && !info.team.length && <p>No staff are assigned to you for this year.</p>}
    {info && !person && <div className="grid gap-4 sm:grid-cols-2">{info.team.map((staff) => {
      const goals = info.goals.filter((goal) => goal.user_id === staff.id)
      const observations = info.observations.filter((item) => item.teacher_id === staff.id).sort((a, b) => b.observation_date.localeCompare(a.observation_date))
      const appraisal = observations.find((item) => item.form_type === "appraisal")
      const hours = sumHours(info.cpd.filter((item) => item.user_id === staff.id))
      return <Card key={staff.id}><CardHeader><CardTitle><button className="text-left underline" onClick={() => setSelected(staff.id)}>{staff.name}</button></CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p>Goals: {goals.length ? goals.map((goal) => <span className="mr-3 inline-flex items-center gap-1" key={goal.id}><span aria-hidden className={`h-2.5 w-2.5 rounded-full ${colours[goal.status]}`} />{names[goal.status]}</span>) : "None"}</p>
        <p>Last observation: {observations[0]?.observation_date ?? "None"}</p><p>CPD: {hours} of {info.target} hours</p><p>Appraisal: {appraisal?.status ?? "None"}</p>
      </CardContent></Card>
    })}</div>}
    {info && person && <><div className="flex flex-wrap items-center justify-between gap-2"><div><Button variant="link" className="px-0" onClick={() => setSelected("")}>Back to team</Button><h2 className="text-xl font-semibold">{person.name}</h2></div>
      <Button asChild variant="outline"><a href={`/api/pd/portfolio?userId=${encodeURIComponent(person.id)}&yearId=${info.year.id}`}>Download year portfolio</a></Button></div>
      <div className="flex flex-wrap gap-2"><Button asChild><Link href={`/pd/observations/new?teacher=${encodeURIComponent(person.id)}&form=fl_learning_walk`}>Start Learning Walk</Link></Button><Button asChild variant="outline"><Link href={`/pd/observations/new?teacher=${encodeURIComponent(person.id)}&form=appraisal`}>Start Appraisal</Link></Button></div>
      <section className="space-y-3"><h3 className="text-lg font-semibold">Goals</h3>
        {info.goals.filter((goal) => goal.user_id === person.id).map((goal) => <Card key={goal.id}><CardContent className="space-y-3 pt-6"><p className="font-semibold">{goal.title} · {names[goal.status]}</p><p className="whitespace-pre-wrap text-sm">{goal.smart_description}</p>
          {goal.action_plan && <p className="whitespace-pre-wrap text-sm"><strong>Action plan:</strong> {goal.action_plan}</p>}{goal.support_required && <p className="whitespace-pre-wrap text-sm"><strong>Support required:</strong> {goal.support_required}</p>}{goal.target_date && <p className="text-sm">Target date: {goal.target_date}</p>}
          {info.updates.filter((update) => update.goal_id === goal.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((update) => <div key={update.id} className="rounded border p-2 text-sm"><p className="font-medium">{info.people.find((p) => p.id === update.author_id)?.name ?? "Staff member"} · {update.created_at.slice(0, 10)}</p><p className="whitespace-pre-wrap">{update.note}</p></div>)}
          <label className="block text-sm" htmlFor={`comment-${goal.id}`}>Add a comment</label><Textarea id={`comment-${goal.id}`} maxLength={5000} value={notes[goal.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [goal.id]: event.target.value }))} />
          <Button size="sm" disabled={comment.isPending || !notes[goal.id]?.trim()} onClick={() => comment.mutate({ goal, note: notes[goal.id] })}>Add comment</Button></CardContent></Card>)}
        {comment.error && <p role="alert" className="text-destructive">{comment.error.message}</p>}{comment.isSuccess && <p role="status">Comment added.</p>}
      </section>
      <section className="space-y-2"><h3 className="text-lg font-semibold">Published observations</h3>{info.observations.filter((item) => item.teacher_id === person.id).map((item) => <p key={item.id}><Link className="underline" href={`/pd/observations/${item.id}`}>{observationNames[item.form_type]} · {item.observation_date}</Link> · {item.status}</p>)}</section>
      <section className="space-y-2"><h3 className="text-lg font-semibold">CPD</h3>{evidenceError && <p role="alert" className="text-destructive">{evidenceError}</p>}{info.cpd.filter((item) => item.user_id === person.id).map((item) => <Card key={item.id}><CardContent className="space-y-2 pt-6 text-sm"><p className="font-semibold">{item.activity_date} · {item.title} · {item.hours} hours</p><p>{activityNames[item.activity_type]}{item.provider ? ` · ${item.provider}` : ""}</p>{item.description && <p className="whitespace-pre-wrap">{item.description}</p>}{item.impact_reflection && <p className="whitespace-pre-wrap"><strong>Teaching impact:</strong> {item.impact_reflection}</p>}{item.evidence_path && <Button variant="outline" size="sm" onClick={() => void openEvidence(item.evidence_path!)}>Open evidence{item.evidence_name ? `: ${item.evidence_name}` : ""}</Button>}</CardContent></Card>)}</section>
    </>}
  </div>
}
