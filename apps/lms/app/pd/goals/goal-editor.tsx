"use client"

import { useState } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { goalSchema } from "@/lib/pd/schemas"
import type { PdGoal, PdSchoolGoal } from "@/lib/pd/types"

const editorSchema = goalSchema.omit({ status: true }).extend({
  target_date: z.union([z.literal(""), z.string().date()]),
  school_goal_id: z.union([z.literal(""), z.string().regex(/^[1-9]\d*$/)]),
  action_plan: z.string().trim().max(5000),
  support_required: z.string().trim().max(5000),
})
type Values = z.infer<typeof editorSchema>
export type GoalFields = {
  title: string
  smart_description: string
  action_plan: string | null
  support_required: string | null
  target_date: string | null
  school_goal_id: number | null
}
type Suggestions = { specific: string; measurable: string; achievable: string; relevant: string; time_bound: string }

export function GoalEditor({ goal, schoolGoals, onSave, onCancel, pending, error }: {
  goal: PdGoal | null
  schoolGoals: PdSchoolGoal[]
  onSave: (values: GoalFields) => void
  onCancel: () => void
  pending: boolean
  error: string | null
}) {
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)
  const [aiError, setAiError] = useState("")
  const [aiLoading, setAiLoading] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(editorSchema),
    defaultValues: {
      title: goal?.title ?? "",
      smart_description: goal?.smart_description ?? "",
      action_plan: goal?.action_plan ?? "",
      support_required: goal?.support_required ?? "",
      target_date: goal?.target_date ?? "",
      school_goal_id: goal?.school_goal_id ? String(goal.school_goal_id) : "",
    },
  })

  async function checkSmart() {
    const text = form.getValues("smart_description").trim()
    if (!text) { setAiError("Enter a SMART goal description first."); return }
    setAiLoading(true)
    setAiError("")
    setSuggestions(null)
    try {
      const response = await fetch("/api/pd/goals/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text }),
      })
      const result: { suggestions?: Suggestions; error?: string } = await response.json()
      if (!response.ok || !result.suggestions) throw new Error(result.error || "Unable to generate feedback.")
      setSuggestions(result.suggestions)
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "Unable to generate feedback.")
    } finally { setAiLoading(false) }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{goal ? "Edit goal" : "Add goal"}</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={form.handleSubmit((value) => onSave({
          ...value,
          action_plan: value.action_plan || null,
          support_required: value.support_required || null,
          target_date: value.target_date || null,
          school_goal_id: value.school_goal_id ? Number(value.school_goal_id) : null,
        }))}>
          <div className="space-y-2"><Label htmlFor="goal-title">Title</Label><Input id="goal-title" {...form.register("title")} />{form.formState.errors.title && <p role="alert" className="text-sm text-destructive">{form.formState.errors.title.message}</p>}</div>
          <div className="space-y-2"><Label htmlFor="smart-description">SMART goal description</Label><Textarea id="smart-description" rows={4} {...form.register("smart_description")} />{form.formState.errors.smart_description && <p role="alert" className="text-sm text-destructive">{form.formState.errors.smart_description.message}</p>}</div>
          <div className="space-y-2"><Button type="button" variant="outline" disabled={aiLoading} onClick={checkSmart}>{aiLoading ? "Checking..." : "Check it’s SMART"}</Button><p className="text-xs text-muted-foreground">Only the goal description is sent to Claude. Remove names and confidential information before checking. Suggestions do not change your goal.</p></div>
          {aiError && <p role="alert" className="text-sm text-destructive">{aiError}</p>}
          {suggestions && <div className="space-y-2 rounded-md border p-4 text-sm"><h3 className="font-semibold">Suggestions</h3>{Object.entries(suggestions).map(([key, value]) => <p key={key}><strong>{key === "time_bound" ? "Time-bound" : key.charAt(0).toUpperCase() + key.slice(1)}:</strong> {value}</p>)}</div>}
          <div className="space-y-2"><Label htmlFor="action-plan">Action plan</Label><Textarea id="action-plan" {...form.register("action_plan")} />{form.formState.errors.action_plan && <p role="alert" className="text-sm text-destructive">{form.formState.errors.action_plan.message}</p>}</div>
          <div className="space-y-2"><Label htmlFor="support-required">Professional development / support required</Label><Textarea id="support-required" {...form.register("support_required")} />{form.formState.errors.support_required && <p role="alert" className="text-sm text-destructive">{form.formState.errors.support_required.message}</p>}</div>
          <div className="space-y-2"><Label htmlFor="target-date">Target completion date</Label><Input id="target-date" type="date" {...form.register("target_date")} />{form.formState.errors.target_date && <p role="alert" className="text-sm text-destructive">{form.formState.errors.target_date.message}</p>}</div>
          <div className="space-y-2"><Label htmlFor="school-goal">Link to school-wide goal</Label><select id="school-goal" className="flex h-10 w-full rounded-md border bg-background px-3 text-sm" {...form.register("school_goal_id")}><option value="">None</option>{schoolGoals.filter((item) => item.is_active || item.id === goal?.school_goal_id).map((item) => <option key={item.id} value={item.id}>{item.title}{item.is_active ? "" : " (inactive)"}</option>)}</select></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save goal"}</Button><Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button></div>
        </form>
      </CardContent>
    </Card>
  )
}
