"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { schoolGoalSchema } from "@/lib/pd/schemas"
import type { PdAcademicYear, PdSchoolGoal } from "@/lib/pd/types"
import type { z } from "zod"

type Values = z.infer<typeof schoolGoalSchema>

export default function SchoolGoalsPage() {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<PdSchoolGoal | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [reordering, setReordering] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schoolGoalSchema),
    defaultValues: { title: "", description: "", is_active: true },
  })

  const year = useQuery({
    queryKey: ["pd", "current-year"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pd_academic_years").select("*").eq("is_current", true).single<PdAcademicYear>()
      if (error) throw error
      return data
    },
  })
  const goals = useQuery({
    queryKey: ["pd", "school-goals", year.data?.id],
    enabled: !!year.data,
    queryFn: async () => {
      if (!year.data) throw new Error("No current academic year.")
      const { data, error } = await supabase.from("pd_school_goals").select("*")
        .eq("year_id", year.data.id).order("sort_order").order("id").returns<PdSchoolGoal[]>()
      if (error) throw error
      return data
    },
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pd", "school-goals"] })
  const save = useMutation({
    retry: false,
    mutationFn: async (values: Values) => {
      if (!year.data) throw new Error("No current academic year.")
      const fields = { title: values.title, description: values.description || null, is_active: values.is_active }
      const result = editing
        ? await supabase.from("pd_school_goals").update(fields).eq("id", editing.id).eq("year_id", year.data.id).select("id").single()
        : await supabase.from("pd_school_goals").insert({
            ...fields, year_id: year.data.id,
            sort_order: Math.max(0, ...(goals.data ?? []).map((goal) => goal.sort_order)) + 1,
          }).select("id").single()
      if (result.error) throw result.error
    },
    onSuccess: async () => { setFormOpen(false); await refresh() },
  })
  const change = useMutation({
    retry: false,
    mutationFn: async ({ goal, fields }: { goal: PdSchoolGoal; fields: Partial<Pick<PdSchoolGoal, "sort_order" | "is_active">> }) => {
      const { error } = await supabase.from("pd_school_goals").update(fields).eq("id", goal.id).select("id").single()
      if (error) throw error
    },
    onSuccess: refresh,
  })
  async function move(index: number, direction: -1 | 1) {
    const list = goals.data
    if (!list || !list[index + direction]) return
    setReordering(true)
    try {
      // Assign distinct positions first, even if imported rows share an order.
      for (const [position, goal] of list.entries()) {
        const newOrder = position === index ? index + direction : position === index + direction ? index : position
        const { error } = await supabase.from("pd_school_goals").update({ sort_order: newOrder + 1 }).eq("id", goal.id).select("id").single()
        if (error) throw error
      }
      await refresh()
    } catch (error) {
      await refresh()
      form.setError("root", { message: error instanceof Error ? error.message : "Unable to reorder school goals." })
    } finally { setReordering(false) }
  }
  function openForm(goal?: PdSchoolGoal) {
    setEditing(goal ?? null)
    form.reset({ title: goal?.title ?? "", description: goal?.description ?? "", is_active: goal?.is_active ?? true })
    save.reset()
    setFormOpen(true)
  }
  const error = year.error || goals.error || change.error

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">School Goals</h1><p className="text-sm text-muted-foreground">{year.data?.name ?? "Current academic year"}</p></div>
        <Button onClick={() => openForm()} disabled={!year.data}>Add school goal</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error.message}</p>}
      {form.formState.errors.root && <p role="alert" className="text-destructive">{form.formState.errors.root.message}</p>}
      {formOpen && (
        <Card><CardHeader><CardTitle>{editing ? "Edit school goal" : "Add school goal"}</CardTitle></CardHeader>
          <CardContent><form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="school-title">Title</Label><Input id="school-title" {...form.register("title")} />{form.formState.errors.title && <p role="alert" className="text-sm text-destructive">{form.formState.errors.title.message}</p>}</div>
            <div className="space-y-2"><Label htmlFor="school-description">Description</Label><Textarea id="school-description" {...form.register("description")} /></div>
            {save.error && <p role="alert" className="text-destructive">{save.error.message}</p>}
            <div className="flex gap-2"><Button disabled={save.isPending} type="submit">Save</Button><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button></div>
          </form></CardContent>
        </Card>
      )}
      {goals.isPending && !error && <p>Loading school goals...</p>}
      {goals.data?.length === 0 && <p className="text-muted-foreground">No school goals yet.</p>}
      {goals.data?.map((goal, index) => (
        <Card key={goal.id}><CardContent className="space-y-3 pt-6">
          <div><h2 className="font-semibold">{goal.title} {!goal.is_active && <span className="text-sm text-muted-foreground">(Inactive)</span>}</h2>{goal.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{goal.description}</p>}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => openForm(goal)}>Edit</Button>
            <Button variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate({ goal, fields: { is_active: !goal.is_active } })}>{goal.is_active ? "Deactivate" : "Reactivate"}</Button>
            <Button variant="outline" size="sm" disabled={reordering || index === 0} onClick={() => void move(index, -1)} aria-label={`Move ${goal.title} up`}>Move up</Button>
            <Button variant="outline" size="sm" disabled={reordering || index === (goals.data?.length ?? 0) - 1} onClick={() => void move(index, 1)} aria-label={`Move ${goal.title} down`}>Move down</Button>
          </div>
        </CardContent></Card>
      ))}
    </div>
  )
}
