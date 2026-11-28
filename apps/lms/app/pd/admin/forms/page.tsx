"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useObservationContext } from "@/lib/pd/observation-context"
import type { PdObservationCategory, PdObservationCriterion } from "@/lib/pd/types"

const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name").max(180),
  guidance: z.string().max(5000),
  questions: z.string().max(5000),
})
const criterionSchema = z.object({
  label: z.string().trim().min(1, "Enter a criterion").max(2000),
  secondary_only: z.boolean(),
})
type CategoryValues = z.infer<typeof categorySchema>
type CriterionValues = z.infer<typeof criterionSchema>

export default function ObservationFormsPage() {
  const { supabase, context } = useObservationContext()
  const queryClient = useQueryClient()
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [editingCriterion, setEditingCriterion] = useState<PdObservationCriterion | "new" | null>(null)
  const [reordering, setReordering] = useState(false)
  const [reorderError, setReorderError] = useState("")
  const categoryForm = useForm<CategoryValues>({ resolver: zodResolver(categorySchema), defaultValues: { name: "", guidance: "", questions: "" } })
  const criterionForm = useForm<CriterionValues>({ resolver: zodResolver(criterionSchema), defaultValues: { label: "", secondary_only: false } })
  const forms = useQuery({
    queryKey: ["pd", "observation-form-settings", context.data?.viewer.id],
    enabled: context.data?.viewer.user_type === "admin",
    queryFn: async () => {
      const [categories, criteria] = await Promise.all([
        supabase.from("pd_obs_categories").select("*").order("sort_order").order("id").returns<PdObservationCategory[]>(),
        supabase.from("pd_obs_criteria").select("*").order("sort_order").order("id").returns<PdObservationCriterion[]>(),
      ])
      if (categories.error) throw new Error(categories.error.message)
      if (criteria.error) throw new Error(criteria.error.message)
      return { categories: categories.data, criteria: criteria.data }
    },
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pd", "observation-form-settings"] })
  const category = forms.data?.categories.find((item) => item.id === categoryId)
  const criteria = forms.data?.criteria.filter((item) => item.category_id === categoryId) ?? []
  const saveCategory = useMutation({
    retry: false,
    mutationFn: async (values: CategoryValues) => {
      if (!categoryId) throw new Error("Select a category.")
      const { error } = await supabase.from("pd_obs_categories").update({
        name: values.name, guidance: values.guidance.trim() || null,
        student_questions: values.questions.split("\n").map((question) => question.trim()).filter(Boolean),
      }).eq("id", categoryId).select("id").single()
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh,
  })
  const saveCriterion = useMutation({
    retry: false,
    mutationFn: async (values: CriterionValues) => {
      if (!categoryId || !editingCriterion) throw new Error("Select a category and criterion.")
      const result = editingCriterion === "new"
        ? await supabase.from("pd_obs_criteria").insert({ ...values, category_id: categoryId, sort_order: Math.max(0, ...criteria.map((item) => item.sort_order)) + 1 }).select("id").single()
        : await supabase.from("pd_obs_criteria").update(values).eq("id", editingCriterion.id).select("id").single()
      if (result.error) throw new Error(result.error.message)
    },
    onSuccess: async () => { setEditingCriterion(null); await refresh() },
  })
  const toggleCriterion = useMutation({
    retry: false,
    mutationFn: async (item: PdObservationCriterion) => {
      const { error } = await supabase.from("pd_obs_criteria").update({ is_active: !item.is_active }).eq("id", item.id).select("id").single()
      if (error) throw new Error(error.message)
    },
    onSuccess: refresh,
  })
  function chooseCategory(item: PdObservationCategory) {
    setCategoryId(item.id)
    setEditingCriterion(null)
    setReorderError("")
    categoryForm.reset({ name: item.name, guidance: item.guidance ?? "", questions: (item.student_questions ?? []).join("\n") })
    saveCategory.reset()
  }
  function editCriterion(item: PdObservationCriterion | "new") {
    setEditingCriterion(item)
    criterionForm.reset({ label: item === "new" ? "" : item.label, secondary_only: item === "new" ? false : item.secondary_only })
    saveCriterion.reset()
  }
  async function move(index: number, direction: -1 | 1) {
    if (!criteria[index + direction]) return
    setReordering(true); setReorderError("")
    try {
      for (const [position, item] of criteria.entries()) {
        const order = position === index ? index + direction : position === index + direction ? index : position
        const { error } = await supabase.from("pd_obs_criteria").update({ sort_order: order + 1 }).eq("id", item.id).select("id").single()
        if (error) throw new Error(error.message)
      }
    } catch (caught) { setReorderError(caught instanceof Error ? caught.message : "Unable to reorder criteria.") }
    finally { await refresh(); setReordering(false) }
  }
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <h1 className="text-2xl font-semibold">Observation Forms</h1>
    {context.isPending && <p>Loading...</p>}
    {context.error && <p role="alert" className="text-destructive">{context.error.message}</p>}
    {context.data && context.data.viewer.user_type !== "admin" && <p role="alert">Only administrators can manage observation forms.</p>}
    {context.data?.viewer.user_type === "admin" && <>
      {forms.isPending && <p>Loading form settings...</p>}
      {forms.error && <p role="alert" className="text-destructive">{forms.error.message}</p>}
      <div className="flex flex-wrap gap-2">{forms.data?.categories.map((item) => <Button key={item.id} variant={item.id === categoryId ? "default" : "outline"} onClick={() => chooseCategory(item)}>{item.name}</Button>)}</div>
      {category && <>
        <Card><CardHeader><CardTitle>Edit category</CardTitle></CardHeader><CardContent>
          <form className="space-y-4" onSubmit={categoryForm.handleSubmit((values) => saveCategory.mutate(values))}>
            <div className="space-y-2"><Label htmlFor="category-name">Name</Label><Input id="category-name" maxLength={180} {...categoryForm.register("name")} />{categoryForm.formState.errors.name && <p role="alert" className="text-destructive">{categoryForm.formState.errors.name.message}</p>}</div>
            <div className="space-y-2"><Label htmlFor="category-guidance">Guidance</Label><Textarea id="category-guidance" maxLength={5000} {...categoryForm.register("guidance")} />{categoryForm.formState.errors.guidance && <p role="alert" className="text-destructive">{categoryForm.formState.errors.guidance.message}</p>}</div>
            <div className="space-y-2"><Label htmlFor="student-questions">Questions to ask students (one per line)</Label><Textarea id="student-questions" maxLength={5000} {...categoryForm.register("questions")} />{categoryForm.formState.errors.questions && <p role="alert" className="text-destructive">{categoryForm.formState.errors.questions.message}</p>}</div>
            {saveCategory.error && <p role="alert" className="text-destructive">{saveCategory.error.message}</p>}
            {saveCategory.isSuccess && <p role="status" className="text-sm">Category saved.</p>}
            <Button disabled={saveCategory.isPending}>Save category</Button>
          </form>
        </CardContent></Card>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">Criteria</h2><Button onClick={() => editCriterion("new")}>Add criterion</Button></div>
        {editingCriterion && <Card><CardHeader><CardTitle>{editingCriterion === "new" ? "Add criterion" : "Edit criterion"}</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={criterionForm.handleSubmit((values) => saveCriterion.mutate(values))}>
          <div className="space-y-2"><Label htmlFor="criterion-label">Criterion</Label><Textarea id="criterion-label" maxLength={2000} {...criterionForm.register("label")} />{criterionForm.formState.errors.label && <p role="alert" className="text-destructive">{criterionForm.formState.errors.label.message}</p>}</div>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" {...criterionForm.register("secondary_only")} />Secondary only</label>
          {saveCriterion.error && <p role="alert" className="text-destructive">{saveCriterion.error.message}</p>}
          <div className="flex gap-2"><Button disabled={saveCriterion.isPending}>Save criterion</Button><Button type="button" variant="outline" onClick={() => setEditingCriterion(null)}>Cancel</Button></div>
        </form></CardContent></Card>}
        {(toggleCriterion.error || reorderError) && <p role="alert" className="text-destructive">{toggleCriterion.error?.message || reorderError}</p>}
        {criteria.length === 0 && <p className="text-muted-foreground">No criteria in this category.</p>}
        {criteria.map((item, index) => <Card key={item.id}><CardContent className="space-y-3 pt-6">
          <p>{item.label} {item.secondary_only && <span className="text-sm text-muted-foreground">(Secondary only)</span>} {!item.is_active && <span className="text-sm text-muted-foreground">(Inactive)</span>}</p>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => editCriterion(item)}>Edit</Button><Button size="sm" variant="outline" disabled={toggleCriterion.isPending} onClick={() => toggleCriterion.mutate(item)}>{item.is_active ? "Deactivate" : "Reactivate"}</Button><Button size="sm" variant="outline" disabled={reordering || index === 0} onClick={() => void move(index, -1)} aria-label={`Move ${item.label} up`}>Move up</Button><Button size="sm" variant="outline" disabled={reordering || index === criteria.length - 1} onClick={() => void move(index, 1)} aria-label={`Move ${item.label} down`}>Move down</Button></div>
        </CardContent></Card>)}
      </>}
    </>}
  </div>
}
