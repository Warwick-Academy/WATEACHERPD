"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useObservationContext } from "@/lib/pd/observation-context"
import { availableObservationForms, observationNames } from "@/lib/pd/observation-ui"
import type { PdObservationFormType } from "@/lib/pd/types"

const schema = z.object({
  teacher_id: z.string().uuid("Select a staff member"),
  form_type: z.enum(["learning_walk", "fl_learning_walk", "appraisal", "self_reflection"]),
  observation_date: z.string().date("Enter a valid date"),
})
type Values = z.infer<typeof schema>

export default function NewObservationPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { supabase, context } = useObservationContext()
  const [search, setSearch] = useState("")
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { teacher_id: "", form_type: "learning_walk", observation_date: localDate } })
  const { setValue } = form
  const teacherId = form.watch("teacher_id")
  const forms = context.data ? availableObservationForms(context.data.viewer.id, teacherId, context.data.viewer.user_type, context.data.ledStaffIds) : []
  useEffect(() => {
    if (!context.data) return
    const params = new URLSearchParams(window.location.search)
    const teacher = params.get("teacher")
    const requestedForm = params.get("form") as PdObservationFormType | null
    if (!teacher || !context.data.people.some((person) => person.id === teacher && person.is_active)) return
    const allowed = availableObservationForms(context.data.viewer.id, teacher, context.data.viewer.user_type, context.data.ledStaffIds)
    setValue("teacher_id", teacher)
    setValue("form_type", requestedForm && allowed.includes(requestedForm) ? requestedForm : allowed[0])
  }, [context.data, setValue])
  const create = useMutation({
    retry: false,
    mutationFn: async (values: Values) => {
      if (!context.data || !forms.includes(values.form_type)) throw new Error("Choose an allowed form for this staff member.")
      const { data, error } = await supabase.from("pd_observations").insert({
        ...values, observer_id: context.data.viewer.id, status: "draft",
      }).select("id").single<{ id: string }>()
      if (error) throw new Error(error.message)
      return data.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ["pd", "observations", context.data?.viewer.id], refetchType: "all" })
      router.push(`/pd/observations/${id}`)
    },
  })
  function chooseTeacher(id: string) {
    form.setValue("teacher_id", id, { shouldValidate: true })
    if (!context.data) return
    const available = availableObservationForms(context.data.viewer.id, id, context.data.viewer.user_type, context.data.ledStaffIds)
    if (!available.includes(form.getValues("form_type"))) form.setValue("form_type", available[0] ?? "learning_walk")
  }
  return <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
    <h1 className="text-2xl font-semibold">Start an observation</h1>
    {context.isPending && <p>Loading staff...</p>}
    {context.error && <p role="alert" className="text-destructive">{context.error.message}</p>}
    {context.data && <form className="space-y-5" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
      <div className="space-y-2"><Label htmlFor="staff-search">Search active staff</Label><Input id="staff-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" /></div>
      <div className="space-y-2"><Label htmlFor="teacher">Staff member</Label>
        <select id="teacher" className="h-10 w-full rounded-md border bg-background px-3" value={teacherId} onChange={(event) => chooseTeacher(event.target.value)}>
          <option value="">Select a staff member</option>
          {context.data.people.filter((person) => person.is_active && (person.name.toLowerCase().includes(search.toLowerCase()) || person.id === teacherId)).map((person) => <option key={person.id} value={person.id}>{person.name}{person.id === context.data.viewer.id ? " (me)" : ""}</option>)}
        </select>{form.formState.errors.teacher_id && <p role="alert" className="text-destructive">{form.formState.errors.teacher_id.message}</p>}
      </div>
      <div className="space-y-2"><Label htmlFor="form-type">Form</Label>
        <select id="form-type" className="h-10 w-full rounded-md border bg-background px-3" disabled={!forms.length} {...form.register("form_type")}>
          {forms.map((type: PdObservationFormType) => <option key={type} value={type}>{observationNames[type]}</option>)}
        </select>
      </div>
      <div className="space-y-2"><Label htmlFor="date">Observation date</Label><Input id="date" type="date" min={context.data.year.start_date} max={context.data.year.end_date} {...form.register("observation_date")} /><p className="text-sm text-muted-foreground">Must be within {context.data.year.name}.</p>{form.formState.errors.observation_date && <p role="alert" className="text-destructive">{form.formState.errors.observation_date.message}</p>}</div>
      {create.error && <p role="alert" className="text-destructive">{create.error.message}</p>}
      <Button type="submit" disabled={create.isPending || !forms.length}>{create.isPending ? "Creating..." : "Create draft"}</Button>
    </form>}
  </div>
}
