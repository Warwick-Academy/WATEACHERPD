"use client"

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useObservationContext, type ObservationPerson, type ObservationViewer } from "@/lib/pd/observation-context"
import { observationNames, observationPermissions } from "@/lib/pd/observation-ui"
import { observationDraftSchema, saveObservationDraft, type ObservationDraftValues } from "@/lib/pd/observation-draft"
import type { PdAcademicYear, PdCriterionRating, PdGoal, PdObservation, PdObservationCategory, PdObservationCriterion, PdObservationRating, PdObservationSection } from "@/lib/pd/types"
import { toast } from "sonner"

async function dispatchNotifications(formType: PdObservation["form_type"]) {
  if (formType === "self_reflection") return
  try {
    const response = await fetch("/api/pd/notifications/dispatch", { method: "POST" })
    if (!response.ok) throw new Error(`Notification dispatch returned ${response.status}.`)
  } catch (error) {
    console.warn("Could not confirm PD notification delivery:", error)
    toast.warning("Your change was saved, but email delivery could not be confirmed. Contact an administrator if needed.")
  }
}

const ratings: Record<PdCriterionRating, string> = { always_mostly: "Always/Mostly", sometimes: "Sometimes", no: "No", na: "N/A" }
const overallRatings = { exceeding: "Exceeding", meeting: "Meeting", almost_meeting: "Almost Meeting", not_meeting: "Not Meeting Expectations" } as const
const responseSchema = z.object({
  response: z.string().max(5000),
  goal_id: z.union([z.literal(""), z.string().uuid()]),
  sections: z.record(z.string().max(5000)),
})
type ResponseValues = z.infer<typeof responseSchema>

type Detail = {
  observation: PdObservation
  categories: PdObservationCategory[]
  criteria: PdObservationCriterion[]
  sections: PdObservationSection[]
  ratings: PdObservationRating[]
  goals: Pick<PdGoal, "id" | "title">[]
  comparison: PdObservationRating[]
}

function visibleCriteria(detail: Detail, teacher: ObservationPerson | undefined) {
  return detail.criteria.filter((criterion) =>
    (criterion.is_active || detail.ratings.some((rating) => rating.criterion_id === criterion.id)) &&
    (teacher?.phase !== "primary" || !criterion.secondary_only))
}

function prettyDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB") : "Not signed"
}

function ObservationDraft({ detail, teacher, viewer, year, supabase }: {
  detail: Detail; teacher: ObservationPerson | undefined; viewer: ObservationViewer; year: PdAcademicYear; supabase: SupabaseClient
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const observation = detail.observation
  const categories = useMemo(() => detail.categories.filter((category) => category.is_active || detail.sections.some((section) => section.category_id === category.id)), [detail])
  const criteria = useMemo(() => visibleCriteria(detail, teacher), [detail, teacher])
  const hasSections = observation.form_type !== "learning_walk"
  const hasRatings = observation.form_type === "appraisal" || observation.form_type === "self_reflection"
  const form = useForm<ObservationDraftValues>({
    resolver: zodResolver(observationDraftSchema),
    defaultValues: {
      observation_date: observation.observation_date,
      year_group: observation.year_group ?? "", subject: observation.subject ?? "", comment: observation.comment ?? "",
      overall_comment: observation.overall_comment ?? "", overall_rating: observation.overall_rating ?? "",
      sections: Object.fromEntries(categories.map((category) => {
        const section = detail.sections.find((item) => item.category_id === category.id)
        return [String(category.id), { evidence_comment: section?.evidence_comment ?? "", reflection_questions: section?.reflection_questions ?? "" }]
      })),
      ratings: Object.fromEntries(criteria.map((criterion) => [String(criterion.id), detail.ratings.find((item) => item.criterion_id === criterion.id)?.rating ?? ""])),
    },
  })
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const version = useRef(0)
  const savedVersion = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)

  const save = useCallback(async () => {
    if (inFlight.current) return inFlight.current
    const operation = async () => {
      while (savedVersion.current !== version.current) {
        const target = version.current
        const result = observationDraftSchema.safeParse(form.getValues())
        if (!result.success) throw new Error("Check the date and field lengths before saving.")
        if (mounted.current) { setSaveState("saving"); setError("") }
        await saveObservationDraft({ supabase, observation, viewerId: viewer.id, year, categories, criteria, values: result.data })
        await queryClient.invalidateQueries({ queryKey: ["pd", "observations", viewer.id] })
        savedVersion.current = target
      }
      if (mounted.current) setSaveState("saved")
    }
    inFlight.current = operation().catch((caught: unknown) => {
      if (mounted.current) { setSaveState("error"); setError(caught instanceof Error ? caught.message : "Unable to save draft.") }
      throw caught
    }).finally(() => { inFlight.current = null })
    return inFlight.current
  }, [categories, criteria, form, observation, queryClient, supabase, viewer.id, year])

  useEffect(() => {
    mounted.current = true
    const subscription = form.watch(() => {
      version.current += 1
      setSaveState("unsaved")
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { void save().catch((caught: unknown) => console.error("Could not autosave observation draft:", caught)) }, 1000)
    })
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (savedVersion.current !== version.current) { event.preventDefault(); event.returnValue = "" }
    }
    const beforeLink = (event: MouseEvent) => {
      if (savedVersion.current === version.current || !(event.target instanceof Element) || !event.target.closest("a[href]")) return
      if (!window.confirm("The draft has unsaved changes. Leaving now may lose them. Leave anyway?")) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    document.addEventListener("click", beforeLink, true)
    return () => {
      mounted.current = false
      subscription.unsubscribe()
      window.removeEventListener("beforeunload", beforeUnload)
      document.removeEventListener("click", beforeLink, true)
      if (timer.current) clearTimeout(timer.current)
      if (savedVersion.current !== version.current) void save().catch((caught: unknown) => console.error("Could not save observation draft before leaving:", caught))
    }
  }, [form, save])

  async function flush() {
    if (timer.current) clearTimeout(timer.current)
    await save()
  }
  async function saveAndReturn() {
    setBusy(true)
    try {
      await flush()
      await queryClient.invalidateQueries({ queryKey: ["pd", "observations", viewer.id], refetchType: "all" })
      toast.success("Draft saved.")
      await new Promise((resolve) => setTimeout(resolve, 600))
      router.push("/pd/observations?tab=written")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save draft.")
    } finally { setBusy(false) }
  }
  async function publish() {
    setBusy(true)
    try {
      await flush()
      const { error } = await supabase.from("pd_observations").update({ status: "published" }).eq("id", observation.id).eq("status", "draft").eq("observer_id", viewer.id).select("id").single()
      if (error) throw new Error(error.message)
      await queryClient.invalidateQueries({ queryKey: ["pd", "observations", viewer.id], refetchType: "all" })
      await dispatchNotifications(observation.form_type)
      router.push("/pd/observations")
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish.") }
    finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true)
    try {
      if (timer.current) clearTimeout(timer.current)
      if (inFlight.current) await inFlight.current
      const { error } = await supabase.from("pd_observations").delete().eq("id", observation.id).eq("status", "draft").eq("observer_id", viewer.id).select("id").single()
      if (error) throw new Error(error.message)
      savedVersion.current = version.current
      await queryClient.invalidateQueries({ queryKey: ["pd", "observations", viewer.id], refetchType: "all" })
      router.push("/pd/observations")
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to delete draft.") }
    finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">Draft</Badge><span aria-live="polite" className="text-sm text-muted-foreground">{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving..." : saveState === "error" ? "Not saved" : "Unsaved changes"}</span></div>
    <fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2"><Label htmlFor="obs-date">Date</Label><Input id="obs-date" type="date" min={year.start_date} max={year.end_date} {...form.register("observation_date")} /></div>
        <div className="space-y-2"><Label htmlFor="year-group">Year group</Label><Input id="year-group" maxLength={100} {...form.register("year_group")} /></div>
        <div className="space-y-2"><Label htmlFor="subject">Subject</Label><Input id="subject" maxLength={100} {...form.register("subject")} /></div>
      </div>
      {observation.form_type === "learning_walk" && <div className="space-y-2"><Label htmlFor="comment">Comment</Label><Textarea id="comment" maxLength={5000} {...form.register("comment")} /></div>}
      {hasSections && categories.map((category) => <Card key={category.id}><CardHeader><CardTitle>{category.name}</CardTitle>{category.guidance && <p className="text-sm text-muted-foreground">{category.guidance}</p>}</CardHeader><CardContent className="space-y-4">
        {category.student_questions?.length > 0 && observation.form_type !== "self_reflection" && <details><summary className="cursor-pointer font-medium">Questions to ask students</summary><ul className="list-disc space-y-1 pl-6 text-sm">{category.student_questions.map((question, index) => <li key={index}>{question}</li>)}</ul></details>}
        <div className="space-y-3">{criteria.filter((criterion) => criterion.category_id === category.id).map((criterion) => <div key={criterion.id} className="rounded-md border p-3">
          <p className="text-sm">{criterion.label}{!criterion.is_active && " (inactive)"}</p>
          {hasRatings && <fieldset className="mt-2 flex flex-wrap gap-2"><legend className="sr-only">Rating for {criterion.label}</legend>{Object.entries(ratings).map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"><input type="radio" value={value} {...form.register(`ratings.${criterion.id}`)} />{label}</label>)}<label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"><input type="radio" value="" {...form.register(`ratings.${criterion.id}`)} />Clear</label></fieldset>}
        </div>)}</div>
        <div className="space-y-2"><Label htmlFor={`evidence-${category.id}`}>{observation.form_type === "self_reflection" ? "Comment" : "Evidence comment"}</Label><Textarea id={`evidence-${category.id}`} maxLength={5000} {...form.register(`sections.${category.id}.evidence_comment`)} /></div>
        {observation.form_type !== "self_reflection" && <div className="space-y-2"><Label htmlFor={`questions-${category.id}`}>Reflection questions</Label><Textarea id={`questions-${category.id}`} maxLength={5000} {...form.register(`sections.${category.id}.reflection_questions`)} /></div>}
      </CardContent></Card>)}
      {observation.form_type === "appraisal" && <Card><CardContent className="space-y-4 pt-6">
        <div className="space-y-2"><Label htmlFor="overall-comment">Final overall comments</Label><Textarea id="overall-comment" maxLength={5000} {...form.register("overall_comment")} /></div>
        <div className="space-y-2"><Label htmlFor="overall-rating">Overall appraisal rating</Label><select id="overall-rating" className="h-10 w-full rounded-md border bg-background px-3" {...form.register("overall_rating")}><option value="">Not selected</option>{Object.entries(overallRatings).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </CardContent></Card>}
    </fieldset>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || saveState === "saving"} onClick={() => void saveAndReturn()}>Save draft</Button>
      <Button disabled={busy} onClick={() => setConfirmPublish(true)}>Publish</Button>
      <Button variant="destructive" disabled={busy} onClick={() => { if (window.confirm("Delete this draft? This cannot be undone.")) void remove() }}>Delete draft</Button>
    </div>
    {confirmPublish && <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="rounded-md border bg-background p-4 shadow-lg">
      <h2 id="publish-title" className="font-semibold">Publish this observation?</h2>
      <p className="my-3 text-sm">The teacher and their Feedback Leader will be able to see this. You won&apos;t be able to edit it after publishing.</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void publish()}>Confirm publish</Button><Button variant="outline" disabled={busy} onClick={() => setConfirmPublish(false)}>Cancel</Button></div>
    </div>}
  </div>
}

function PublishedObservation({ detail, teacher, observer, viewer, year, supabase, onReopen }: {
  detail: Detail; teacher: ObservationPerson | undefined; observer: ObservationPerson | undefined
  viewer: ObservationViewer; year: PdAcademicYear; supabase: SupabaseClient; onReopen: () => void
}) {
  const queryClient = useQueryClient()
  const observation = detail.observation
  const permissions = observationPermissions(observation, viewer.id, viewer.user_type)
  const [compare, setCompare] = useState(false)
  const form = useForm<ResponseValues>({
    resolver: zodResolver(responseSchema),
    defaultValues: { response: observation.teacher_response ?? "", goal_id: observation.goal_id ?? "", sections: Object.fromEntries(detail.categories.map((category) => [String(category.id), detail.sections.find((section) => section.category_id === category.id)?.teacher_response ?? ""])) },
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pd", "observation", observation.id] })
  const action = useMutation({
    retry: false,
    mutationFn: async ({ name, values }: { name: "respond" | "acknowledge" | "sign" | "reopen"; values?: ResponseValues }) => {
      const result = name === "respond" && values
        ? await supabase.rpc("pd_respond_to_observation", {
            p_obs: observation.id, p_response: values.response,
            p_sections: observation.form_type === "learning_walk" ? [] : Object.entries(values.sections).map(([category_id, teacher_response]) => ({ category_id: Number(category_id), teacher_response })),
            p_goal: values.goal_id || null,
          })
        : await supabase.rpc(name === "acknowledge" ? "pd_acknowledge_observation" : name === "sign" ? "pd_sign_appraisal" : "pd_reopen_observation", { p_obs: observation.id })
      if (result.error) throw new Error(result.error.message)
      return name
    },
    onSuccess: async (name, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["pd", "observations", viewer.id], refetchType: "all" })
      if (name === "reopen") { onReopen(); return }
      if (name === "respond" && variables.values) form.reset(variables.values)
      await dispatchNotifications(observation.form_type)
      await refresh()
    },
  })
  const criteria = visibleCriteria(detail, teacher)
  const categories = detail.categories.filter((category) => detail.sections.some((section) => section.category_id === category.id) || criteria.some((criterion) => criterion.category_id === category.id))
  const isTeacher = viewer.id === observation.teacher_id
  const isAppraisal = observation.form_type === "appraisal"
  const isSelf = observation.form_type === "self_reflection"
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2"><Badge variant="outline">{observation.status}</Badge><span className="text-sm">{observation.observation_date} · Observed by {observer?.name ?? "Staff member"}</span></div>
    {(observation.year_group || observation.subject) && <p className="text-sm">Year group: {observation.year_group || "—"} · Subject: {observation.subject || "—"}</p>}
    {observation.comment && <Card><CardContent className="whitespace-pre-wrap pt-6">{observation.comment}</CardContent></Card>}
    {isTeacher && isAppraisal && detail.comparison.length > 0 && <Button variant="outline" onClick={() => setCompare(!compare)}>{compare ? "Hide self-reflection" : "Compare with my self-reflection"}</Button>}
    <form className="space-y-5" onSubmit={form.handleSubmit((values) => action.mutate({ name: "respond", values }))}>
      <fieldset disabled={action.isPending} className="space-y-5">
      {observation.form_type !== "learning_walk" && categories.map((category) => {
        const section = detail.sections.find((item) => item.category_id === category.id)
        return <Card key={category.id}><CardHeader><CardTitle>{category.name}</CardTitle></CardHeader><CardContent className="space-y-3">
          {criteria.filter((criterion) => criterion.category_id === category.id).map((criterion) => {
            const rating = detail.ratings.find((item) => item.criterion_id === criterion.id)?.rating
            const own = detail.comparison.find((item) => item.criterion_id === criterion.id)?.rating
            return <div className="rounded-md border p-3 text-sm" key={criterion.id}><p>{criterion.label}</p>{rating && <p>Rating: {ratings[rating]}</p>}{compare && <p>My self-reflection: {own ? ratings[own] : "Not rated"}</p>}</div>
          })}
          {section?.evidence_comment && <div><h3 className="font-medium">{isSelf ? "Comment" : "Evidence"}</h3><p className="whitespace-pre-wrap text-sm">{section.evidence_comment}</p></div>}
          {section?.reflection_questions && <div><h3 className="font-medium">Reflection questions</h3><p className="whitespace-pre-wrap text-sm">{section.reflection_questions}</p></div>}
          {permissions.canRespond && !isSelf ? <div className="space-y-2"><Label htmlFor={`response-${category.id}`}>Your response</Label><Textarea id={`response-${category.id}`} maxLength={5000} {...form.register(`sections.${category.id}`)} /></div>
            : section?.teacher_response && <div><h3 className="font-medium">Teacher response</h3><p className="whitespace-pre-wrap text-sm">{section.teacher_response}</p></div>}
        </CardContent></Card>
      })}
      {observation.overall_comment && <p className="whitespace-pre-wrap"><strong>Overall comments:</strong> {observation.overall_comment}</p>}
      {observation.overall_rating && <p><strong>Overall rating:</strong> {overallRatings[observation.overall_rating]}</p>}
      {permissions.canRespond && !isSelf ? <Card><CardContent className="space-y-4 pt-6">
        <div className="space-y-2"><Label htmlFor="teacher-response">{observation.form_type === "learning_walk" ? "Your reply" : "Overall notes"}</Label><Textarea id="teacher-response" maxLength={5000} {...form.register("response")} /></div>
        {observation.year_id === year.id && <div className="space-y-2"><Label htmlFor="goal-link">Link to one of my current-year goals (optional)</Label><select id="goal-link" className="h-10 w-full rounded-md border bg-background px-3" {...form.register("goal_id")}><option value="">No new link</option>{detail.goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select><p className="text-sm text-muted-foreground">An existing link is retained if no new goal is selected.</p></div>}
        <Button type="submit" disabled={action.isPending}>Save response</Button>
      </CardContent></Card> : observation.teacher_response && <p className="whitespace-pre-wrap"><strong>Teacher response:</strong> {observation.teacher_response}</p>}
      </fieldset>
    </form>
    {isAppraisal && <div className="rounded-md border p-4 text-sm"><p>Teacher signed: {prettyDate(observation.teacher_signed_at)}</p><p>Observer signed: {prettyDate(observation.observer_signed_at)}</p>{observation.status === "signed" && <p className="font-medium">This appraisal is locked.</p>}</div>}
    {observation.teacher_acknowledged_at && <p className="text-sm">Acknowledged: {prettyDate(observation.teacher_acknowledged_at)}</p>}
    {action.error && <p role="alert" className="text-destructive">{action.error.message}</p>}
    {action.isSuccess && action.data === "respond" && <p role="status" className="text-sm">Response saved.</p>}
    <div className="flex flex-wrap gap-2">
      {permissions.canAcknowledge && <Button variant="outline" disabled={action.isPending || form.formState.isDirty} onClick={() => action.mutate({ name: "acknowledge" })}>Acknowledge</Button>}
      {permissions.canSign && <Button disabled={action.isPending || (isTeacher && form.formState.isDirty)} onClick={() => { if (window.confirm(isTeacher ? "Sign this appraisal? Your response cannot be changed after you sign." : "Sign this appraisal? It will be locked once both parties have signed.")) action.mutate({ name: "sign" }) }}>Sign appraisal</Button>}
      {permissions.canReopen && <Button variant="outline" disabled={action.isPending} onClick={() => { if (window.confirm("Reopen this observation? It will return to the observer as a private draft, and signatures will be cleared.")) action.mutate({ name: "reopen" }) }}>Reopen</Button>}
    </div>
    {isTeacher && form.formState.isDirty && (permissions.canAcknowledge || permissions.canSign) && <p className="text-sm text-muted-foreground">Save your response before acknowledging or signing.</p>}
    {permissions.canReopen && <p className="text-sm text-muted-foreground">Reopening returns this observation to its observer as a private draft. Only the observer can edit or delete it.</p>}
  </div>
}

export default function ObservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { supabase, context } = useObservationContext()
  const [reopened, setReopened] = useState(false)
  const detail = useQuery({
    queryKey: ["pd", "observation", id, context.data?.viewer.id],
    enabled: !!context.data && !reopened,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<Detail> => {
      if (!context.data) throw new Error("Please sign in again.")
      const [observation, categories, criteria, sections, ratingsResult] = await Promise.all([
        supabase.from("pd_observations").select("*").eq("id", id).maybeSingle<PdObservation>(),
        supabase.from("pd_obs_categories").select("*").order("sort_order").order("id").returns<PdObservationCategory[]>(),
        supabase.from("pd_obs_criteria").select("*").order("sort_order").order("id").returns<PdObservationCriterion[]>(),
        supabase.from("pd_observation_sections").select("*").eq("observation_id", id).returns<PdObservationSection[]>(),
        supabase.from("pd_observation_ratings").select("*").eq("observation_id", id).returns<PdObservationRating[]>(),
      ])
      for (const result of [observation, categories, criteria, sections, ratingsResult]) if (result.error) throw new Error(result.error.message)
      if (!observation.data) throw new Error("Observation not found or you do not have access.")
      let goals: Pick<PdGoal, "id" | "title">[] = []
      let comparison: PdObservationRating[] = []
      if (observation.data.teacher_id === context.data.viewer.id && observation.data.year_id === context.data.year.id) {
        const result = await supabase.from("pd_goals").select("id,title").eq("user_id", context.data.viewer.id).eq("year_id", context.data.year.id).order("created_at").returns<Pick<PdGoal, "id" | "title">[]>()
        if (result.error) throw new Error(result.error.message)
        goals = result.data
      }
      if (observation.data.teacher_id === context.data.viewer.id && observation.data.form_type === "appraisal" && observation.data.year_id) {
        const reflection = await supabase.from("pd_observations").select("id").eq("teacher_id", context.data.viewer.id).eq("form_type", "self_reflection").eq("year_id", observation.data.year_id).order("observation_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle<{ id: string }>()
        if (reflection.error) throw new Error(reflection.error.message)
        if (reflection.data) {
          const result = await supabase.from("pd_observation_ratings").select("*").eq("observation_id", reflection.data.id).returns<PdObservationRating[]>()
          if (result.error) throw new Error(result.error.message)
          comparison = result.data
        }
      }
      return { observation: observation.data, categories: categories.data ?? [], criteria: criteria.data ?? [], sections: sections.data ?? [], ratings: ratingsResult.data ?? [], goals, comparison }
    },
  })
  const observation = detail.data?.observation
  const teacher = context.data?.people.find((person) => person.id === observation?.teacher_id)
  const observer = context.data?.people.find((person) => person.id === observation?.observer_id)
  return <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
    <Link href="/pd/observations" className="text-sm underline">Back to observations</Link>
    {reopened ? <p role="status">Reopened. The observation has returned to the observer as a private draft.</p> : <>
      {(context.isPending || (!!context.data && !detail.isFetchedAfterMount && !detail.error)) && <p>Loading observation...</p>}
      {(context.error || detail.error) && <p role="alert" className="text-destructive">{(context.error || detail.error)?.message}</p>}
      {detail.isFetchedAfterMount && !detail.error && detail.data && context.data && observation && <>
        <div><h1 className="text-2xl font-semibold">{observationNames[observation.form_type]}</h1><p className="text-sm text-muted-foreground">Staff member: {teacher?.name ?? "Staff member"}</p></div>
        {observation.status === "draft"
          ? <ObservationDraft detail={detail.data} teacher={teacher} viewer={context.data.viewer} year={context.data.year} supabase={supabase} />
          : <PublishedObservation key={`${observation.id}-${observation.status}`} detail={detail.data} teacher={teacher} observer={observer} viewer={context.data.viewer} year={context.data.year} supabase={supabase} onReopen={() => setReopened(true)} />}
      </>}
    </>}
  </div>
}
