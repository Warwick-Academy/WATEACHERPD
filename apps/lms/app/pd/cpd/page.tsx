"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { createCourseSlug } from "@/lib/slug"
import { getCpdSignedUrl } from "@/lib/pd/cpd"
import { removeUnusedEvidence, uploadEvidence } from "@/lib/pd/cpd-evidence"
import { readAll } from "@/lib/pd/report-utils"
import type { PdAcademicYear, PdCpdActivity, PdGoal, PdUserType } from "@/lib/pd/types"
import { CpdEditor, activityNames, type CpdFields } from "./cpd-editor"

type Person = { id: string; name: string; department: string | null; is_active: boolean }
type Viewer = Person & { user_type: PdUserType }
type Assignment = { staff_id: string; year_id: number }
type Course = { id: number; title: string; pd_hours: number | string | null }
type InProgressTraining = { id: string; progress: number | null; courses: { id: number; title: string } | null }
const sourceNames = { manual: "My entry", admin: "Added by school", course: "Training course" } as const

export default function CpdPage() {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [selectedYear, setSelectedYear] = useState("")
  const [selectedPerson, setSelectedPerson] = useState("")
  const [editor, setEditor] = useState<"new" | PdCpdActivity | null>(null)
  const [notice, setNotice] = useState("")
  const [evidenceError, setEvidenceError] = useState("")
  const [goalSelections, setGoalSelections] = useState<Record<string, string>>({})
  const context = useQuery({
    queryKey: ["pd", "cpd-context"],
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) throw new Error(error?.message ?? "Please sign in again.")
      const [profile, years, people, settings, assignments] = await Promise.all([
        supabase.from("profiles").select("id,name,department,is_active,user_type").eq("id", user.id).single<Viewer>(),
        supabase.from("pd_academic_years").select("*").order("start_date", { ascending: false }).returns<PdAcademicYear[]>(),
        supabase.from("profiles").select("id,name,department,is_active").order("name").returns<Person[]>(),
        supabase.from("pd_settings").select("annual_cpd_target_hours").eq("id", 1).single<{ annual_cpd_target_hours: number }>(),
        supabase.from("pd_feedback_assignments").select("staff_id,year_id").eq("leader_id", user.id).returns<Assignment[]>(),
      ])
      for (const result of [profile, years, people, settings, assignments]) if (result.error) throw new Error(result.error.message)
      const currentYear = years.data?.find((year) => year.is_current)
      if (!profile.data || !currentYear || !settings.data) throw new Error("A staff profile and current academic year are required.")
      return { viewer: profile.data, years: years.data ?? [], currentYear, people: people.data ?? [], settings: settings.data, assignments: assignments.data ?? [] }
    },
  })
  const viewer = context.data?.viewer
  const yearId = selectedYear ? Number(selectedYear) : context.data?.currentYear.id
  const ownerId = selectedPerson || viewer?.id
  const canViewAll = viewer?.user_type === "admin" || viewer?.user_type === "leadership"
  const people = context.data?.people.filter((person) => person.id !== viewer?.id &&
    (canViewAll || context.data?.assignments.some((assignment) => assignment.staff_id === person.id && assignment.year_id === yearId))) ?? []
  const isOwn = !!viewer && ownerId === viewer.id
  const isCurrent = yearId === context.data?.currentYear.id
  const activities = useQuery({
    queryKey: ["pd", "cpd-activities", viewer?.id, ownerId, yearId],
    enabled: !!viewer && !!ownerId && !!yearId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase.from("pd_cpd_activities").select("*").eq("user_id", ownerId!).eq("year_id", yearId!).order("activity_date", { ascending: false }).order("created_at", { ascending: false }).returns<PdCpdActivity[]>()
      if (error) throw new Error(error.message)
      return data
    },
  })
  const goals = useQuery({
    queryKey: ["pd", "cpd-goals", viewer?.id, context.data?.currentYear.id],
    enabled: !!viewer && isOwn && isCurrent,
    queryFn: async () => {
      if (!viewer || !context.data) throw new Error("Please sign in again.")
      const { data, error } = await supabase.from("pd_goals").select("id,title").eq("user_id", viewer.id).eq("year_id", context.data.currentYear.id).order("created_at").returns<Pick<PdGoal, "id" | "title">[]>()
      if (error) throw new Error(error.message)
      return data
    },
  })
  const courses = useQuery({
    queryKey: ["pd", "cpd-training", viewer?.id],
    enabled: !!viewer,
    queryFn: async () => {
      const { data, error } = await supabase.from("courses").select("id,title,pd_hours").eq("is_published", true).order("title").returns<Course[]>()
      if (error) throw new Error(error.message)
      return data
    },
  })
  const inProgress = useQuery({
    queryKey: ["pd", "cpd-in-progress", viewer?.id],
    enabled: isOwn,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      if (!viewer) throw new Error("Please sign in again.")
      return readAll<InProgressTraining>((from, to) => supabase.from("enrollments")
        .select("id,progress,courses(id,title)").eq("user_id", viewer.id).eq("status", "active")
        .order("id").range(from, to).returns<InProgressTraining[]>())
    },
  })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["pd", "cpd-activities"] }),
    queryClient.invalidateQueries({ queryKey: ["pd", "goal-details"] }),
  ])
  const save = useMutation({
    retry: false,
    mutationFn: async ({ values, file, remove }: { values: CpdFields; file: File | null; remove: boolean }) => {
      if (!viewer || !isOwn) throw new Error("You can only manage your own CPD entries.")
      const existing = editor !== "new" ? editor : null
      let newPath: string | null = null
      if (file) newPath = await uploadEvidence(supabase, viewer.id, file)
      const fields = {
        ...values, provider: values.provider || null, description: values.description || null,
        impact_reflection: values.impact_reflection || null,
        evidence_path: newPath ?? (remove ? null : existing?.evidence_path ?? null),
        evidence_name: file?.name ?? (remove ? null : existing?.evidence_name ?? null),
      }
      try {
        const result = existing
          ? await supabase.from("pd_cpd_activities").update(fields).eq("id", existing.id).eq("user_id", viewer.id).eq("source", "manual").eq("updated_at", existing.updated_at).select("id").single()
          : await supabase.from("pd_cpd_activities").insert({ ...fields, user_id: viewer.id, created_by: viewer.id, source: "manual" }).select("id").single()
        if (result.error) throw new Error(result.error.message)
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unable to save CPD."
        if (newPath) {
          try { await removeUnusedEvidence(supabase, newPath) }
          catch (cleanup) { throw new Error(`${message} The uploaded file could not be removed: ${cleanup instanceof Error ? cleanup.message : "storage error"}`) }
        }
        throw new Error(message)
      }
      if (existing?.evidence_path && (newPath || remove)) {
        try { await removeUnusedEvidence(supabase, existing.evidence_path) }
        catch (caught) { return `Entry saved, but old evidence could not be removed: ${caught instanceof Error ? caught.message : "storage error"}` }
      }
      return "CPD entry saved."
    },
    onSuccess: async (message) => { setEditor(null); setNotice(message); await refresh() },
  })
  const remove = useMutation({
    retry: false,
    mutationFn: async (entry: PdCpdActivity) => {
      if (!viewer || entry.user_id !== viewer.id || entry.source !== "manual") throw new Error("Only your own manual entries can be deleted.")
      const { error } = await supabase.from("pd_cpd_activities").delete().eq("id", entry.id).eq("user_id", viewer.id).eq("source", "manual").eq("updated_at", entry.updated_at).select("id").single()
      if (error) throw new Error(error.message)
      if (entry.evidence_path) {
        try { await removeUnusedEvidence(supabase, entry.evidence_path) }
        catch (caught) { return `Entry deleted, but evidence could not be removed: ${caught instanceof Error ? caught.message : "storage error"}` }
      }
      return "CPD entry deleted."
    },
    onSuccess: async (message) => { setNotice(message); await refresh() },
  })
  const linkGoal = useMutation({
    retry: false,
    mutationFn: async ({ entry, goal }: { entry: PdCpdActivity; goal: string }) => {
      if (!viewer || entry.user_id !== viewer.id) throw new Error("You can only link your own CPD entries.")
      if (goal && (!isCurrent || !goals.data?.some((item) => item.id === goal))) throw new Error("Choose one of your own current-year goals.")
      const { error } = await supabase.rpc("pd_link_cpd_to_goal", { p_cpd: entry.id, p_goal: goal || null })
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => { setGoalSelections({}); setNotice("Goal link saved."); await refresh() },
  })
  async function openEvidence(path: string) {
    setEvidenceError("")
    const tab = window.open("about:blank", "_blank")
    if (!tab) { setEvidenceError("Allow pop-ups to open evidence."); return }
    tab.opener = null
    try {
      const { data, error } = await getCpdSignedUrl(supabase, path)
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "Unable to open evidence.")
      tab.location.href = data.signedUrl
    } catch (caught) { tab.close(); setEvidenceError(caught instanceof Error ? caught.message : "Unable to open evidence.") }
  }
  const total = (activities.data ?? []).reduce((sum, item) => sum + Number(item.hours), 0)
  const training = (activities.data ?? []).filter((item) => item.source === "course").reduce((sum, item) => sum + Number(item.hours), 0)
  const target = Number(context.data?.settings.annual_cpd_target_hours ?? 0)
  const error = context.error || activities.error || goals.error || courses.error
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const selectedAcademicYear = context.data?.years.find((year) => year.id === yearId)
  const defaultDate = selectedAcademicYear && localDate >= selectedAcademicYear.start_date && localDate <= selectedAcademicYear.end_date
    ? localDate : selectedAcademicYear?.start_date ?? localDate
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <div><h1 className="text-2xl font-semibold">CPD Log</h1><p className="text-sm text-muted-foreground">Record professional development and its impact.</p><p className="text-sm text-muted-foreground">Training courses appear here after completion if they award PD hours.</p></div>
    {context.isPending && <p>Loading CPD...</p>}
    {error && <p role="alert" className="text-destructive">{error.message}</p>}
    {evidenceError && <p role="alert" className="text-destructive">{evidenceError}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {context.data && <>
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2"><Label htmlFor="cpd-year">Academic year</Label><select id="cpd-year" className="h-10 min-w-48 rounded-md border bg-background px-3" value={String(yearId)} onChange={(event) => { setSelectedYear(event.target.value); setSelectedPerson(""); setEditor(null); setNotice(""); setGoalSelections({}) }}>{context.data.years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.is_current ? " (current)" : ""}</option>)}</select></div>
        {!!people.length && <div className="space-y-2"><Label htmlFor="cpd-person">Staff member</Label><select id="cpd-person" className="h-10 min-w-48 rounded-md border bg-background px-3" value={ownerId ?? ""} onChange={(event) => { setSelectedPerson(event.target.value === viewer?.id ? "" : event.target.value); setEditor(null); setNotice(""); setGoalSelections({}) }}><option value={viewer?.id}>My CPD</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>}
      </div>
      {ownerId && yearId && <Button asChild variant="outline"><a href={`/api/pd/portfolio?userId=${encodeURIComponent(ownerId)}&yearId=${yearId}`}>Download year portfolio</a></Button>}
      <Card><CardHeader><CardTitle>{isCurrent ? "Hours this year" : "Hours in this year"}</CardTitle></CardHeader><CardContent className="space-y-3">
        {activities.isPending ? <p>Loading hours...</p> : activities.data && <><p className="font-semibold">{total.toFixed(2).replace(/\.?0+$/, "")} of {target} hours</p><Progress value={target > 0 ? Math.min(100, total / target * 100) : 0} /><p className="text-sm text-muted-foreground">Training: {training} hours · Other: {Math.round((total - training) * 100) / 100} hours</p></>}
      </CardContent></Card>
      {isOwn && <Card><CardHeader><CardTitle>In-progress Training Courses</CardTitle></CardHeader><CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">Current enrolments from all years. Hours are not credited until completion.</p>
        {inProgress.isPending && <p>Loading in-progress courses...</p>}
        {inProgress.error && <p role="alert" className="text-destructive">{inProgress.error.message}</p>}
        {inProgress.data?.length === 0 && <p className="text-sm text-muted-foreground">No courses in progress.</p>}
        {inProgress.data?.map((entry) => <p key={entry.id} className="text-sm">{entry.courses ? <Link className="underline" href={`/learner/courses/${createCourseSlug(entry.courses.title, entry.courses.id)}`}>{entry.courses.title}</Link> : "Course unavailable"}{entry.progress !== null && ` · ${entry.progress}% complete`}</p>)}
      </CardContent></Card>}
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">Entries</h2>{isOwn && !editor && <Button onClick={() => { save.reset(); setNotice(""); setEditor("new") }}>Add entry</Button>}</div>
      {editor && isOwn && <CpdEditor key={editor === "new" ? "new" : editor.id} activity={editor === "new" ? null : editor} defaultDate={defaultDate} pending={save.isPending} error={save.error?.message ?? null} onCancel={() => { setEditor(null); save.reset() }} onSave={(values, file, removeEvidence) => save.mutate({ values, file, remove: removeEvidence })} />}
      {(remove.error || linkGoal.error) && <p role="alert" className="text-destructive">{(remove.error || linkGoal.error)?.message}</p>}
      {activities.data?.length === 0 && <p className="text-muted-foreground">No CPD entries for this year.</p>}
      {activities.data?.map((entry) => <Card key={entry.id}><CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{entry.title}</h3><p className="text-sm text-muted-foreground">{entry.activity_date} · {activityNames[entry.activity_type]} · {entry.hours} hours{entry.provider ? ` · ${entry.provider}` : ""}</p></div><Badge variant="secondary">{sourceNames[entry.source]}</Badge></div>
        {entry.description && <p className="whitespace-pre-wrap text-sm">{entry.description}</p>}
        {entry.impact_reflection && <p className="whitespace-pre-wrap text-sm"><strong>What will change:</strong> {entry.impact_reflection}</p>}
        {entry.evidence_path && <Button variant="outline" size="sm" onClick={() => void openEvidence(entry.evidence_path!)}>Open evidence{entry.evidence_name ? `: ${entry.evidence_name}` : ""}</Button>}
        {isOwn && (isCurrent || entry.goal_id) && <div className="space-y-2">
          {isCurrent ? <><Label htmlFor={`goal-${entry.id}`}>Link to one of my current-year goals</Label><select id={`goal-${entry.id}`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={goalSelections[entry.id] ?? entry.goal_id ?? ""} onChange={(event) => setGoalSelections((current) => ({ ...current, [entry.id]: event.target.value }))}><option value="">No goal</option>{goals.data?.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select><Button variant="outline" size="sm" disabled={linkGoal.isPending || goals.isPending} onClick={() => linkGoal.mutate({ entry, goal: goalSelections[entry.id] ?? entry.goal_id ?? "" })}>Save goal link</Button></>
            : <Button variant="outline" size="sm" disabled={linkGoal.isPending} onClick={() => linkGoal.mutate({ entry, goal: "" })}>Remove previous-year goal link</Button>}
        </div>}
        {isOwn && entry.source === "manual" && <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { save.reset(); setEditor(entry); setNotice("") }}>Edit</Button><Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => { if (window.confirm("Delete this CPD entry?")) remove.mutate(entry) }}>Delete</Button></div>}
      </CardContent></Card>)}
      <Card><CardHeader><CardTitle>Earn hours with Training</CardTitle></CardHeader><CardContent className="space-y-2">
        <Link href="/learner/courses" className="underline">Browse Training courses</Link>
        {courses.isPending && <p className="text-sm">Loading courses...</p>}
        {courses.data?.length === 0 && <p className="text-sm text-muted-foreground">No published courses available.</p>}
        {courses.data?.map((course) => <p key={course.id} className="text-sm"><Link href={`/learner/courses/${createCourseSlug(course.title, course.id)}`} className="underline">{course.title}</Link> · {Number(course.pd_hours ?? 0)} PD hours</p>)}
      </CardContent></Card>
    </>}
  </div>
}
