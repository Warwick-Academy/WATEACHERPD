"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { observationNames } from "@/lib/pd/observation-ui"
import { activityNames } from "@/app/pd/cpd/cpd-editor"
import { downloadCsv, filterTrends, readAll, sumHours, summariseTrends, type TeacherTrend } from "@/lib/pd/report-utils"
import type { PdAcademicYear, PdCpdActivity, PdGoal, PdObservation, PdSchoolGoal, PdStaffYearSummary, PdUserType } from "@/lib/pd/types"

type Person = { id: string; name: string; department: string | null; phase: string }
type Filter = "all" | string
const selectClass = "h-10 min-w-40 rounded-md border bg-background px-3 text-sm"

export default function ReportsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [yearChoice, setYearChoice] = useState("")
  const [department, setDepartment] = useState<Filter>("all")
  const [phase, setPhase] = useState<Filter>("all")
  const [type, setType] = useState<Filter>("all")
  const [staff, setStaff] = useState<Filter>("all")
  const [observer, setObserver] = useState<Filter>("all")
  const context = useQuery({
    queryKey: ["pd", "reports-context"],
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) throw new Error(error?.message ?? "Please sign in again.")
      const profile = await supabase.from("profiles").select("user_type").eq("id", user.id).single<{ user_type: PdUserType }>()
      if (profile.error) throw new Error(profile.error.message)
      if (!["admin", "leadership"].includes(profile.data.user_type)) throw new Error("Reports are available to administrators and leadership.")
      const [years, settings, people] = await Promise.all([
        readAll<PdAcademicYear>((from, to) => supabase.from("pd_academic_years").select("*").order("id").range(from, to)),
        supabase.from("pd_settings").select("annual_cpd_target_hours").eq("id", 1).single<{ annual_cpd_target_hours: number }>(),
        readAll<Person>((from, to) => supabase.from("profiles").select("id,name,department,phase").order("id").range(from, to)),
      ])
      if (settings.error) throw new Error(settings.error.message)
      const current = years.find((year) => year.is_current)
      if (!current) throw new Error("A current academic year is required.")
      return { user, years, current, target: Number(settings.data.annual_cpd_target_hours), people }
    },
  })
  const yearId = yearChoice ? Number(yearChoice) : context.data?.current.id
  const report = useQuery({
    queryKey: ["pd", "reports", context.data?.user.id, yearId],
    enabled: !!context.data && !!yearId,
    queryFn: async () => {
      if (!yearId) throw new Error("Choose an academic year.")
      const [schoolGoals, goals, summaries, observations, cpd, trends] = await Promise.all([
        readAll<PdSchoolGoal>((from, to) => supabase.from("pd_school_goals").select("*").eq("year_id", yearId).order("id").range(from, to)),
        readAll<PdGoal>((from, to) => supabase.from("pd_goals").select("*").eq("year_id", yearId).order("id").range(from, to)),
        readAll<PdStaffYearSummary>((from, to) => supabase.from("pd_v_staff_year_summary").select("*").eq("year_id", yearId).order("user_id").range(from, to)),
        readAll<PdObservation>((from, to) => supabase.from("pd_observations").select("*").eq("year_id", yearId).neq("status", "draft").order("id").range(from, to)),
        readAll<PdCpdActivity>((from, to) => supabase.from("pd_cpd_activities").select("*").eq("year_id", yearId).order("id").range(from, to)),
        readAll<TeacherTrend>((from, to) => supabase.from("pd_v_criteria_ratings_by_teacher").select("*").eq("year_id", yearId).order("teacher_id").order("criterion_id").range(from, to)),
      ])
      return { schoolGoals, goals, summaries, observations, cpd, trends }
    },
  })
  const people = context.data?.people ?? []
  const included = new Set(people.filter((person) => (department === "all" || person.department === department) && (phase === "all" || person.phase === phase)).map((person) => person.id))
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Staff member"
  const departments = [...new Set(people.map((p) => p.department).filter((value): value is string => !!value))].sort()
  const data = report.data
  const goals = data?.goals.filter((goal) => included.has(goal.user_id)) ?? []
  const summaries = data?.summaries.filter((summary) => included.has(summary.user_id)) ?? []
  const observations = data?.observations.filter((item) => included.has(item.teacher_id) && (type === "all" || item.form_type === type) && (staff === "all" || item.teacher_id === staff) && (observer === "all" || item.observer_id === observer)) ?? []
  const cpd = data?.cpd.filter((item) => included.has(item.user_id)) ?? []
  const cpdStaff = people.filter((person) => included.has(person.id)).map((person) => ({
    ...person, hours: sumHours(cpd.filter((item) => item.user_id === person.id)),
  })).sort((a, b) => a.name.localeCompare(b.name))
  const trends = summariseTrends(filterTrends(data?.trends ?? [], department, phase))
  const schoolRows = (data?.schoolGoals ?? []).map((schoolGoal) => {
    const linked = goals.filter((goal) => goal.school_goal_id === schoolGoal.id)
    return [schoolGoal.title, linked.length, linked.filter((g) => g.status === "complete").length, linked.filter((g) => g.status === "on_track").length, linked.filter((g) => g.status === "needs_support").length] as const
  })
  const staffRows = summaries.map((s) => [s.name, s.department, s.phase, s.goals_total, s.goals_complete, Number(s.cpd_hours), Number(s.training_hours), s.learning_walks, s.fl_learning_walks, s.appraisal_status, s.appraisal_rating])
  const observationRows = observations.map((o) => [o.observation_date, observationNames[o.form_type], personName(o.teacher_id), personName(o.observer_id), o.status, o.id])
  const hoursByType = Object.entries(activityNames).map(([key, name]) => [name, sumHours(cpd.filter((item) => item.activity_type === key))] as const)
  const target = context.data?.target ?? 0
  const trendRows = trends.map((t) => [t.category, t.criterion, t.always_mostly, t.sometimes, t.no, t.na, t.total])
  const maxTrend = Math.max(1, ...trends.map((t) => t.sometimes + t.no))
  const makeCsv = (name: string, rows: (string | number | null | undefined)[][]) => downloadCsv(`${name}-${yearId}.csv`, rows)
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <h1 className="text-2xl font-semibold">Reports</h1>
    {context.isPending && <p>Loading reports...</p>}{(context.error || report.error) && <p role="alert" className="text-destructive">{(context.error || report.error)?.message}</p>}
    {context.data && <div className="flex flex-wrap gap-4">
      <div className="space-y-2"><Label htmlFor="report-year">Academic year</Label><select id="report-year" className={selectClass} value={String(yearId)} onChange={(e) => setYearChoice(e.target.value)}>{context.data.years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="report-department">Department</Label><select id="report-department" className={selectClass} value={department} onChange={(e) => setDepartment(e.target.value)}><option value="all">All departments</option>{departments.map((name) => <option key={name}>{name}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="report-phase">Phase</Label><select id="report-phase" className={selectClass} value={phase} onChange={(e) => setPhase(e.target.value)}><option value="all">All phases</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="both">Both</option></select></div>
    </div>}
    {report.isFetching && context.data && <p>Loading selected year...</p>}
    {data && <>
      <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle>School-wide goal tracking</CardTitle><Button variant="outline" onClick={() => makeCsv("school-goals", [["School goal", "Linked goals", "Complete", "On track", "Needs support"], ...schoolRows.map((r) => [...r])])}>Export CSV</Button></CardHeader><CardContent className="space-y-2 text-sm">{schoolRows.map((r, i) => <p key={data.schoolGoals[i].id}><strong>{r[0]}</strong> · {r[1]} linked · {r[2]} complete · {r[3]} on track · {r[4]} need support</p>)}{!schoolRows.length && <p>No school-wide goals.</p>}</CardContent></Card>
      <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle>Staff summary</CardTitle><Button variant="outline" onClick={() => makeCsv("staff-summary", [["Staff", "Department", "Phase", "Goals", "Complete", "CPD hours", "Training hours", "Learning Walks", "Feedback Leader walks", "Appraisal status", "Appraisal rating"], ...staffRows])}>Export CSV</Button></CardHeader><CardContent className="space-y-2 text-sm">{summaries.map((s) => <p key={s.user_id}><strong>{s.name}</strong> · Goals {s.goals_complete}/{s.goals_total} · CPD {Number(s.cpd_hours)} hours (Training {Number(s.training_hours)}) · Learning Walks {s.learning_walks + s.fl_learning_walks} · Appraisal {s.appraisal_status ?? "none"}{s.appraisal_rating ? `, ${s.appraisal_rating.replace(/_/g, " ")}` : ""}</p>)}{!summaries.length && <p>No staff in this selection.</p>}</CardContent></Card>
      <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle>Observation history</CardTitle><Button variant="outline" onClick={() => makeCsv("observations", [["Date", "Type", "Staff", "Observer", "Status", "Observation ID"], ...observationRows])}>Export CSV</Button></CardHeader><CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2"><select aria-label="Observation type" className={selectClass} value={type} onChange={(e) => setType(e.target.value)}><option value="all">All types</option>{Object.entries(observationNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select><select aria-label="Observed staff" className={selectClass} value={staff} onChange={(e) => setStaff(e.target.value)}><option value="all">All staff</option>{people.filter((p) => included.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Observer" className={selectClass} value={observer} onChange={(e) => setObserver(e.target.value)}><option value="all">All observers</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        {observations.map((o) => <p key={o.id}><Link className="underline" href={`/pd/observations/${o.id}`}>{observationNames[o.form_type]} · {o.observation_date}</Link> · {personName(o.teacher_id)} · Observer: {personName(o.observer_id)} · {o.status}</p>)}{!observations.length && <p>No published observations.</p>}
      </CardContent></Card>
      <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle>CPD participation and hours</CardTitle><Button variant="outline" onClick={() => makeCsv("cpd", [["Section", "Name", "Hours", "Target", "Below target"], ...cpdStaff.map((s) => ["Staff", s.name, s.hours, target, s.hours < target ? "Yes" : "No"]), ...hoursByType.map(([name, hours]) => ["Activity type", name, hours, "", ""])])}>Export CSV</Button></CardHeader><CardContent className="space-y-3 text-sm"><div><h3 className="font-semibold">By staff</h3>{cpdStaff.map((s) => <p key={s.id}>{s.name} · {s.hours} hours{s.hours < target ? " · Below target" : ""}</p>)}</div><div><h3 className="font-semibold">By activity type</h3>{hoursByType.map(([name, hours]) => <p key={name}>{name} · {hours} hours</p>)}</div><p>Annual target: {target} hours</p></CardContent></Card>
      <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2"><CardTitle>Criteria trends</CardTitle><Button variant="outline" onClick={() => makeCsv("criteria-trends", [["Category", "Criterion", "Always / mostly", "Sometimes", "No", "N/A", "Total"], ...trendRows])}>Export CSV</Button></CardHeader><CardContent className="space-y-4 text-sm">{trends.map((t) => <div key={t.criterion_id}><p>{t.category}: {t.criterion}</p><div className="mt-1 h-3 rounded bg-muted" role="img" aria-label={`${t.sometimes} sometimes, ${t.no} no`}><div className="h-full rounded bg-amber-500" style={{ width: `${(t.sometimes + t.no) / maxTrend * 100}%` }} /></div><p className="text-muted-foreground">Sometimes: {t.sometimes} · No: {t.no}</p></div>)}{!trends.length && <p>No appraisal ratings for this selection.</p>}</CardContent></Card>
    </>}
  </div>
}
