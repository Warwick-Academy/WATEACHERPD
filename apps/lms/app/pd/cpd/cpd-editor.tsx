"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cpdActivitySchema } from "@/lib/pd/schemas"
import { evidenceFileInfo } from "@/lib/pd/cpd-evidence"
import type { PdCpdActivity, PdCpdActivityType } from "@/lib/pd/types"

export const activityNames: Record<PdCpdActivityType, string> = {
  platform_course: "Training course", workshop_inset: "In-school workshop / INSET", microsoft_learn: "Microsoft Learn",
  external_course: "External course", conference: "Conference", peer_observation: "Peer observation",
  reading_research: "Reading / research", other: "Other",
}
const schema = cpdActivitySchema.omit({ evidence_path: true, evidence_name: true, goal_id: true }).extend({
  activity_type: z.enum(["workshop_inset", "microsoft_learn", "external_course", "conference", "peer_observation", "reading_research", "other"]),
  hours: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Enter hours with up to two decimal places").refine((value) => Number(value) > 0 && Number(value) <= 100, "Hours must be greater than 0 and no more than 100"),
  provider: z.string().trim().max(180), description: z.string().trim().max(5000), impact_reflection: z.string().trim().max(5000),
})
type Values = z.infer<typeof schema>
export type CpdFields = Omit<Values, "hours"> & { hours: number }

export function CpdEditor({ activity, defaultDate, onSave, onCancel, pending, error }: {
  activity: PdCpdActivity | null
  defaultDate: string
  onSave: (values: CpdFields, file: File | null, removeEvidence: boolean) => void
  onCancel: () => void
  pending: boolean
  error: string | null
}) {
  const [file, setFile] = useState<File | null>(null)
  const [removeEvidence, setRemoveEvidence] = useState(false)
  const [fileError, setFileError] = useState("")
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: {
    title: activity?.title ?? "", activity_date: activity?.activity_date ?? defaultDate,
    activity_type: activity?.activity_type !== "platform_course" ? activity?.activity_type ?? "other" : "other",
    provider: activity?.provider ?? "", hours: activity ? String(activity.hours) : "",
    description: activity?.description ?? "", impact_reflection: activity?.impact_reflection ?? "",
  } })
  return <Card><CardHeader><CardTitle>{activity ? "Edit CPD entry" : "Add CPD entry"}</CardTitle></CardHeader><CardContent>
    <form className="space-y-4" onSubmit={form.handleSubmit((values) => {
      if (file) {
        try { evidenceFileInfo(file) } catch (caught) { setFileError(caught instanceof Error ? caught.message : "Invalid file."); return }
      }
      setFileError("")
      onSave({ ...values, hours: Number(values.hours) }, file, removeEvidence)
    })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="cpd-date">Date</Label><Input id="cpd-date" type="date" {...form.register("activity_date")} />{form.formState.errors.activity_date && <p role="alert" className="text-sm text-destructive">{form.formState.errors.activity_date.message}</p>}</div>
        <div className="space-y-2"><Label htmlFor="cpd-hours">Hours</Label><Input id="cpd-hours" type="number" min="0.01" max="100" step="0.01" {...form.register("hours")} />{form.formState.errors.hours && <p role="alert" className="text-sm text-destructive">{form.formState.errors.hours.message}</p>}</div>
      </div>
      <p className="text-sm text-muted-foreground">The activity date determines the academic year. Dates outside configured years are recorded in the current year.</p>
      <div className="space-y-2"><Label htmlFor="cpd-title">Title</Label><Input id="cpd-title" maxLength={180} {...form.register("title")} />{form.formState.errors.title && <p role="alert" className="text-sm text-destructive">{form.formState.errors.title.message}</p>}</div>
      <div className="space-y-2"><Label htmlFor="cpd-type">Activity type</Label><select id="cpd-type" className="h-10 w-full rounded-md border bg-background px-3" {...form.register("activity_type")}>{Object.entries(activityNames).filter(([value]) => value !== "platform_course").map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="cpd-provider">Provider</Label><Input id="cpd-provider" maxLength={180} {...form.register("provider")} /></div>
      <div className="space-y-2"><Label htmlFor="cpd-description">Description / details</Label><Textarea id="cpd-description" maxLength={5000} {...form.register("description")} /></div>
      <div className="space-y-2"><Label htmlFor="cpd-impact">What will you change in your teaching? (optional)</Label><Textarea id="cpd-impact" maxLength={5000} {...form.register("impact_reflection")} /></div>
      <div className="space-y-2"><Label htmlFor="cpd-evidence">Evidence (PDF, PNG, JPG or DOCX; maximum 10 MB)</Label>
        <Input id="cpd-evidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFileError("") }} />
        {activity?.evidence_name && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removeEvidence} onChange={(event) => setRemoveEvidence(event.target.checked)} />Remove existing evidence: {activity.evidence_name}</label>}
        {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex gap-2"><Button disabled={pending}>{pending ? "Saving..." : "Save entry"}</Button><Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button></div>
    </form>
  </CardContent></Card>
}
