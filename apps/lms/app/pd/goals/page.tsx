"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { getGoalPermissions } from "@/lib/pd/goal-permissions"
import { goalUpdateSchema } from "@/lib/pd/schemas"
import type { PdAcademicYear, PdGoal, PdGoalStatus, PdGoalUpdate, PdSchoolGoal } from "@/lib/pd/types"
import { GoalEditor, type GoalFields } from "./goal-editor"

type Viewer = { id: string; user_type: "user" | "admin" | "instructor" | "leadership"; name: string }
type Person = { id: string; name: string }
type Evidence = { id: string; goal_id: string; title: string; date: string }
const statusNames: Record<PdGoalStatus, string> = {
  not_started: "Not started", on_track: "On track", needs_support: "Needs support", complete: "Complete",
}
const statusStyle: Record<PdGoalStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  on_track: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  needs_support: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  complete: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
}
const updateSchema = goalUpdateSchema.extend({
  status: z.enum(["unchanged", "not_started", "on_track", "needs_support", "complete"]),
  is_checkin: z.boolean(),
})
type UpdateValues = z.infer<typeof updateSchema>

function GoalCard({ goal, supabase, viewer, canEdit, canUpdate, schoolGoals, onEdit }: {
  goal: PdGoal
  supabase: SupabaseClient
  viewer: Viewer
  canEdit: boolean
  canUpdate: boolean
  schoolGoals: PdSchoolGoal[]
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const form = useForm<UpdateValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: { note: "", status: "unchanged", is_checkin: false },
  })
  const details = useQuery({
    queryKey: ["pd", "goal-details", viewer.id, goal.id],
    queryFn: async () => {
      const [updates, cpd, observations] = await Promise.all([
        supabase.from("pd_goal_updates").select("*").eq("goal_id", goal.id).order("created_at", { ascending: false }).returns<PdGoalUpdate[]>(),
        supabase.from("pd_cpd_activities").select("id,goal_id,title,activity_date").eq("goal_id", goal.id),
        supabase.from("pd_observations").select("id,goal_id,form_type,observation_date").eq("goal_id", goal.id).neq("status", "draft"),
      ])
      if (updates.error) throw new Error(updates.error.message)
      if (cpd.error) throw new Error(cpd.error.message)
      if (observations.error) throw new Error(observations.error.message)
      const authorIds = [...new Set((updates.data ?? []).map((update) => update.author_id))]
      let authors: Person[] = []
      if (authorIds.length) {
        const result = await supabase.from("profiles").select("id,name").in("id", authorIds).returns<Person[]>()
        if (result.error) throw new Error(result.error.message)
        authors = result.data ?? []
      }
      const cpdEvidence: Evidence[] = (cpd.data ?? []).map((item) => ({
        id: item.id, goal_id: item.goal_id, title: item.title, date: item.activity_date,
      }))
      const observationEvidence: Evidence[] = (observations.data ?? []).map((item) => ({
        id: item.id, goal_id: item.goal_id, title: item.form_type.replace(/_/g, " "), date: item.observation_date,
      }))
      return { updates: updates.data ?? [], authors, cpd: cpdEvidence, observations: observationEvidence }
    },
  })
  const addUpdate = useMutation({
    retry: false,
    mutationFn: async (value: UpdateValues) => {
      const { error } = await supabase.from("pd_goal_updates").insert({
        goal_id: goal.id, author_id: viewer.id, note: value.note,
        status: value.status === "unchanged" ? null : value.status, is_checkin: value.is_checkin,
      }).select("id").single()
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      form.reset()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pd", "goal-details", viewer.id, goal.id] }),
        queryClient.invalidateQueries({ queryKey: ["pd", "goals", viewer.id] }),
      ])
    },
  })
  const schoolGoal = schoolGoals.find((item) => item.id === goal.school_goal_id)
  return (
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><CardTitle>{goal.title}</CardTitle><Badge className={statusStyle[goal.status]}>{statusNames[goal.status]}</Badge></div></CardHeader>
      <CardContent className="space-y-5">
        <div><h3 className="font-medium">SMART goal</h3><p className="whitespace-pre-wrap text-sm">{goal.smart_description}</p></div>
        {goal.action_plan && <div><h3 className="font-medium">Action plan</h3><p className="whitespace-pre-wrap text-sm">{goal.action_plan}</p></div>}
        {goal.support_required && <div><h3 className="font-medium">Support required</h3><p className="whitespace-pre-wrap text-sm">{goal.support_required}</p></div>}
        {goal.target_date && <p className="text-sm">Target date: {goal.target_date}</p>}
        {schoolGoal && <p className="text-sm">School goal: {schoolGoal.title}</p>}
        {canEdit && <Button variant="outline" onClick={onEdit}>Edit goal</Button>}
        <section className="space-y-3">
          <h3 className="font-semibold">Running record</h3>
          {details.isPending && <p className="text-sm text-muted-foreground">Loading updates and evidence...</p>}
          {details.error && <p role="alert" className="text-sm text-destructive">{details.error.message}</p>}
          {details.data?.updates.length === 0 && <p className="text-sm text-muted-foreground">No progress updates yet.</p>}
          {details.data?.updates.map((update) => (
            <div key={update.id} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{details.data.authors.find((author) => author.id === update.author_id)?.name ?? "Staff member"} · {new Date(update.created_at).toLocaleDateString("en-GB")} {update.author_id !== goal.user_id && <Badge variant="secondary">Feedback Leader</Badge>} {update.is_checkin && <Badge variant="outline">Mid-year check-in</Badge>}</p>
              <p className="whitespace-pre-wrap">{update.note}</p>
              {update.status && <p>Status: {statusNames[update.status]}</p>}
            </div>
          ))}
          {canUpdate && <form className="space-y-3" onSubmit={form.handleSubmit((value) => addUpdate.mutate(value))}>
            <div className="space-y-2"><Label htmlFor={`note-${goal.id}`}>Add progress update</Label><Textarea id={`note-${goal.id}`} {...form.register("note")} />{form.formState.errors.note && <p role="alert" className="text-sm text-destructive">{form.formState.errors.note.message}</p>}</div>
            <div className="space-y-2"><Label htmlFor={`status-${goal.id}`}>New status (optional)</Label><select id={`status-${goal.id}`} className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" {...form.register("status")}><option value="unchanged">Keep current status</option>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="flex items-center gap-2"><Checkbox id={`checkin-${goal.id}`} checked={form.watch("is_checkin")} onCheckedChange={(checked) => form.setValue("is_checkin", checked === true)} /><Label htmlFor={`checkin-${goal.id}`}>Mid-year check-in</Label></div>
            {addUpdate.error && <p role="alert" className="text-sm text-destructive">{addUpdate.error.message}</p>}
            <Button type="submit" disabled={addUpdate.isPending}>{addUpdate.isPending ? "Saving..." : "Add update"}</Button>
          </form>}
        </section>
        <section className="space-y-2"><h3 className="font-semibold">Linked evidence</h3>
          {details.data && !details.data.cpd.length && !details.data.observations.length && <p className="text-sm text-muted-foreground">No linked evidence yet.</p>}
          {details.data?.observations.map((item) => <p key={item.id} className="text-sm">Observation: <Link className="underline" href={`/pd/observations/${item.id}`}>{item.title}</Link> · {item.date}</p>)}
          {details.data?.cpd.map((item) => <p key={item.id} className="text-sm">CPD: {item.title} · {item.date}</p>)}
        </section>
      </CardContent>
    </Card>
  )
}

export default function GoalsPage() {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [selectedYear, setSelectedYear] = useState("")
  const [selectedPerson, setSelectedPerson] = useState("")
  const [editor, setEditor] = useState<"new" | PdGoal | null>(null)

  const session = useQuery({
    queryKey: ["pd", "goals-viewer"],
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) throw new Error(error?.message ?? "Please sign in again.")
      const profile = await supabase.from("profiles").select("id,name,user_type").eq("id", user.id).single<Viewer>()
      if (profile.error) throw new Error(profile.error.message)
      return profile.data
    },
  })
  const viewer = session.data
  const years = useQuery({
    queryKey: ["pd", "goal-years", viewer?.id],
    enabled: !!viewer,
    queryFn: async () => {
      const result = await supabase.from("pd_academic_years").select("*").order("start_date", { ascending: false }).returns<PdAcademicYear[]>()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
  const currentYear = years.data?.find((year) => year.is_current)
  const yearId = selectedYear ? Number(selectedYear) : currentYear?.id
  const ownerId = selectedPerson || viewer?.id
  const isAdmin = viewer?.user_type === "admin"
  const directory = useQuery({
    queryKey: ["pd", "goal-directory", viewer?.id, yearId],
    enabled: !!viewer && !!yearId,
    queryFn: async () => {
      if (!viewer || !yearId) throw new Error("Missing staff or academic year.")
      const assignments = await supabase.from("pd_feedback_assignments").select("staff_id").eq("leader_id", viewer.id).eq("year_id", yearId)
      if (assignments.error) throw new Error(assignments.error.message)
      const ledIds: string[] = (assignments.data ?? []).map((row) => row.staff_id)
      if (!ledIds.length && viewer.user_type !== "admin" && viewer.user_type !== "leadership") return { people: [] as Person[], ledIds }
      let query = supabase.from("profiles").select("id,name").order("name")
      if (viewer.user_type !== "admin" && viewer.user_type !== "leadership") query = query.in("id", ledIds)
      const people = await query.returns<Person[]>()
      if (people.error) throw new Error(people.error.message)
      return { people: people.data ?? [], ledIds }
    },
  })
  const settings = useQuery({
    queryKey: ["pd", "goal-settings", viewer?.id],
    enabled: !!viewer,
    queryFn: async () => {
      const result = await supabase.from("pd_settings").select("max_goals_per_year").eq("id", 1).single<{ max_goals_per_year: number }>()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
  const schoolGoals = useQuery({
    queryKey: ["pd", "school-goals", yearId, viewer?.id],
    enabled: !!yearId && !!viewer,
    queryFn: async () => {
      const result = await supabase.from("pd_school_goals").select("*").eq("year_id", yearId!).order("sort_order").returns<PdSchoolGoal[]>()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
  const goals = useQuery({
    queryKey: ["pd", "goals", viewer?.id, ownerId, yearId],
    enabled: !!viewer && !!ownerId && !!yearId,
    queryFn: async () => {
      const result = await supabase.from("pd_goals").select("*").eq("user_id", ownerId!).eq("year_id", yearId!).order("created_at").returns<PdGoal[]>()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
  const save = useMutation({
    retry: false,
    mutationFn: async (fields: GoalFields) => {
      if (!viewer || !ownerId || !yearId) throw new Error("Select a staff member and academic year.")
      const result = editor && editor !== "new"
        ? await supabase.from("pd_goals").update(fields).eq("id", editor.id).select("id").single()
        : await supabase.from("pd_goals").insert({ ...fields, user_id: ownerId, year_id: yearId }).select("id").single()
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: async () => {
      setEditor(null)
      await queryClient.invalidateQueries({ queryKey: ["pd", "goals", viewer?.id] })
    },
  })
  const error = session.error || years.error || directory.error || settings.error || schoolGoals.error || goals.error
  const isCurrent = !!yearId && yearId === currentYear?.id
  const isOwner = ownerId === viewer?.id
  const isLeader = !!ownerId && !!directory.data?.ledIds.includes(ownerId)
  const { canEdit, canUpdate } = viewer
    ? getGoalPermissions({ role: viewer.user_type, isCurrentYear: isCurrent, isOwner, isLeader })
    : { canEdit: false, canUpdate: false }
  const count = goals.data?.length ?? 0
  const max = settings.data?.max_goals_per_year
  function changeYear(value: string) { setSelectedYear(value); setSelectedPerson(""); setEditor(null); save.reset() }
  function changePerson(value: string) { setSelectedPerson(value === viewer?.id ? "" : value); setEditor(null); save.reset() }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div><h1 className="text-2xl font-semibold">My Goals</h1><p className="text-sm text-muted-foreground">Set goals and keep a running record of progress.</p></div>
      {error && <p role="alert" className="text-destructive">{error.message}</p>}
      {session.isPending || years.isPending ? <p>Loading goals...</p> : !currentYear ? <p role="alert" className="text-destructive">No current academic year is configured.</p> : (
        <>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2"><Label htmlFor="goal-year">Academic year</Label><select id="goal-year" value={String(yearId ?? "")} onChange={(event) => changeYear(event.target.value)} className="flex h-10 min-w-48 rounded-md border bg-background px-3 text-sm">{years.data?.map((year) => <option key={year.id} value={year.id}>{year.name}{year.is_current ? " (current)" : ""}</option>)}</select></div>
            {!!directory.data?.people.length && <div className="space-y-2"><Label htmlFor="goal-person">Staff member</Label><select id="goal-person" value={ownerId ?? ""} onChange={(event) => changePerson(event.target.value)} className="flex h-10 min-w-48 rounded-md border bg-background px-3 text-sm"><option value={viewer?.id}>My goals</option>{directory.data.people.filter((person) => person.id !== viewer?.id).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>}
          </div>
          {!isCurrent && !isAdmin && <p className="text-sm text-muted-foreground">Earlier years are read-only.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3"><p>{goals.isSuccess && max !== undefined ? `${count} of ${max} goals` : "Loading goal limit..."}</p>{canEdit && goals.isSuccess && max !== undefined && count < max && !editor && <Button onClick={() => { save.reset(); setEditor("new") }}>Add goal</Button>}</div>
          {editor && <GoalEditor key={editor === "new" ? "new" : editor.id} goal={editor === "new" ? null : editor} schoolGoals={schoolGoals.data ?? []} onSave={(values) => save.mutate(values)} onCancel={() => { setEditor(null); save.reset() }} pending={save.isPending} error={save.error?.message ?? null} />}
          {goals.isPending && <p>Loading goals...</p>}
          {goals.data?.length === 0 && <p className="text-muted-foreground">No goals for this academic year.</p>}
          {goals.data?.map((goal) => <GoalCard key={goal.id} goal={goal} supabase={supabase} viewer={viewer!} canEdit={canEdit} canUpdate={canUpdate} schoolGoals={schoolGoals.data ?? []} onEdit={() => { save.reset(); setEditor(goal) }} />)}
        </>
      )}
    </div>
  )
}
