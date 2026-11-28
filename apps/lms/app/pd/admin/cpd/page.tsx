"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { activityNames } from "@/app/pd/cpd/cpd-editor"
import type { PdCpdActivity, PdUserType } from "@/lib/pd/types"

type Person = { id: string; name: string; department: string | null }
type BatchEntry = Pick<PdCpdActivity, "id" | "batch_id" | "title" | "activity_date" | "hours" | "created_at">
const schema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(180),
  activity_type: z.enum(["workshop_inset", "microsoft_learn", "external_course", "conference", "peer_observation", "reading_research", "other"]),
  provider: z.string().trim().max(180),
  activity_date: z.string().date("Enter a valid date"),
  hours: z.string().regex(/^\d+(?:\.\d{1,2})?$/, "Enter hours with up to two decimal places").refine((value) => Number(value) > 0 && Number(value) <= 100, "Hours must be greater than 0 and no more than 100"),
  description: z.string().trim().max(5000),
})
type Values = z.infer<typeof schema>

export default function BulkCpdPage() {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [department, setDepartment] = useState("")
  const [search, setSearch] = useState("")
  const [notice, setNotice] = useState("")
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: "", activity_type: "workshop_inset", provider: "", activity_date: localDate, hours: "", description: "" } })
  const context = useQuery({
    queryKey: ["pd", "bulk-cpd-viewer"],
    queryFn: async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error || !user) throw new Error(error?.message ?? "Please sign in again.")
      const profile = await supabase.from("profiles").select("user_type").eq("id", user.id).single<{ user_type: PdUserType }>()
      if (profile.error) throw new Error(profile.error.message)
      return { id: user.id, role: profile.data.user_type }
    },
  })
  const isAdmin = context.data?.role === "admin"
  const people = useQuery({
    queryKey: ["pd", "bulk-cpd-people", context.data?.id],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,name,department").eq("is_active", true).order("name").returns<Person[]>()
      if (error) throw new Error(error.message)
      return data
    },
  })
  const batches = useQuery({
    queryKey: ["pd", "bulk-cpd-batches", context.data?.id],
    enabled: isAdmin,
    queryFn: async () => {
      const all: BatchEntry[] = []
      for (let start = 0; ; start += 1000) {
        const { data, error } = await supabase.from("pd_cpd_activities").select("id,batch_id,title,activity_date,hours,created_at")
          .eq("source", "admin").not("batch_id", "is", null).order("created_at", { ascending: false }).order("id").range(start, start + 999).returns<BatchEntry[]>()
        if (error) throw new Error(error.message)
        all.push(...data)
        if (data.length < 1000) break
      }
      const grouped = new Map<string, { first: BatchEntry; count: number }>()
      for (const entry of all) {
        if (!entry.batch_id) continue
        const existing = grouped.get(entry.batch_id)
        if (existing) existing.count += 1
        else grouped.set(entry.batch_id, { first: entry, count: 1 })
      }
      return Array.from(grouped.entries())
    },
  })
  const assign = useMutation({
    retry: false,
    mutationFn: async (values: Values) => {
      if (!isAdmin || !selected.length) throw new Error("Select at least one active staff member.")
      const { data, error } = await supabase.rpc("pd_assign_cpd_bulk", {
        p_user_ids: selected, p_title: values.title, p_activity_type: values.activity_type,
        p_provider: values.provider || null, p_activity_date: values.activity_date,
        p_hours: Number(values.hours), p_description: values.description || null,
      })
      if (error) throw new Error(error.message)
      if (typeof data !== "number") throw new Error("The number of staff added was not returned.")
      return data
    },
    onSuccess: async (count) => {
      setOpen(false); setSelected([]); setNotice(`Added to ${count} staff.`); form.reset()
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["pd", "bulk-cpd-batches"] }), queryClient.invalidateQueries({ queryKey: ["pd", "cpd-activities"] })])
    },
  })
  const remove = useMutation({
    retry: false,
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.from("pd_cpd_activities").delete().eq("source", "admin").eq("batch_id", batchId).select("id")
      if (error) throw new Error(error.message)
      if (!data.length) throw new Error("No entries were removed. Refresh and try again.")
      return data.length
    },
    onSuccess: async (count) => {
      setNotice(`Removed ${count} CPD ${count === 1 ? "entry" : "entries"}.`)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["pd", "bulk-cpd-batches"] }), queryClient.invalidateQueries({ queryKey: ["pd", "cpd-activities"] })])
    },
  })
  const departments = [...new Set((people.data ?? []).map((person) => person.department).filter((value): value is string => !!value))].sort()
  const error = context.error || people.error || batches.error || remove.error
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Bulk CPD</h1>{isAdmin && <Button onClick={() => { setNotice(""); assign.reset(); setOpen(true) }}>Add CPD to staff</Button>}</div>
    {context.isPending && <p>Loading...</p>}
    {context.data && !isAdmin && <p role="alert">Only administrators can add bulk CPD.</p>}
    {error && <p role="alert" className="text-destructive">{error.message}</p>}
    {notice && <p role="status">{notice}</p>}
    {isAdmin && <>
      {batches.isPending && <p>Loading previous entries...</p>}
      {batches.data?.length === 0 && <p className="text-muted-foreground">No bulk CPD entries yet.</p>}
      {batches.data?.map(([id, batch]) => <Card key={id}><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div><h2 className="font-semibold">{batch.first.title}</h2><p className="text-sm text-muted-foreground">{batch.first.activity_date} · {batch.first.hours} hours · {batch.count} staff</p></div>
        <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove this entire batch from ${batch.count} staff?`)) remove.mutate(id) }}>Remove batch</Button>
      </CardContent></Card>)}
      <Dialog open={open} onOpenChange={(value) => { if (!assign.isPending) setOpen(value) }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add CPD to staff</DialogTitle><DialogDescription>Choose active staff and enter the shared activity details.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => assign.mutate(values))}>
          <div className="space-y-2"><Label htmlFor="bulk-title">Title</Label><Input id="bulk-title" maxLength={180} {...form.register("title")} />{form.formState.errors.title && <p role="alert" className="text-destructive">{form.formState.errors.title.message}</p>}</div>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="bulk-date">Date</Label><Input id="bulk-date" type="date" {...form.register("activity_date")} />{form.formState.errors.activity_date && <p role="alert" className="text-destructive">{form.formState.errors.activity_date.message}</p>}</div><div className="space-y-2"><Label htmlFor="bulk-hours">Hours</Label><Input id="bulk-hours" type="number" min="0.01" max="100" step="0.01" {...form.register("hours")} />{form.formState.errors.hours && <p role="alert" className="text-destructive">{form.formState.errors.hours.message}</p>}</div></div>
          <div className="space-y-2"><Label htmlFor="bulk-type">Activity type</Label><select id="bulk-type" className="h-10 w-full rounded-md border bg-background px-3" {...form.register("activity_type")}>{Object.entries(activityNames).filter(([value]) => value !== "platform_course").map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="bulk-provider">Provider</Label><Input id="bulk-provider" maxLength={180} {...form.register("provider")} /></div>
          <div className="space-y-2"><Label htmlFor="bulk-description">Description / details</Label><Textarea id="bulk-description" maxLength={5000} {...form.register("description")} /></div>
          <fieldset className="space-y-3"><legend className="font-medium">Staff ({selected.length} selected)</legend>
            <Input aria-label="Search staff" placeholder="Search staff" value={search} onChange={(event) => setSearch(event.target.value)} />
            <div className="flex flex-wrap gap-2"><select aria-label="Department" className="h-10 rounded-md border bg-background px-3" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Select department</option>{departments.map((name) => <option key={name} value={name}>{name}</option>)}</select>
              <Button type="button" variant="outline" disabled={!department} onClick={() => setSelected((current) => [...new Set([...current, ...(people.data ?? []).filter((person) => person.department === department).map((person) => person.id)])])}>Select department</Button>
              <Button type="button" variant="outline" onClick={() => setSelected((people.data ?? []).map((person) => person.id))}>Select all</Button>
              <Button type="button" variant="outline" onClick={() => setSelected([])}>Clear</Button>
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-3">{people.data?.filter((person) => person.name.toLowerCase().includes(search.toLowerCase())).map((person) => <label key={person.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(person.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} />{person.name}{person.department ? ` · ${person.department}` : ""}</label>)}</div>
          </fieldset>
          {assign.error && <p role="alert" className="text-destructive">{assign.error.message}</p>}
          <Button type="submit" disabled={assign.isPending || !selected.length}>{assign.isPending ? "Adding..." : "Add CPD"}</Button>
        </form>
      </DialogContent></Dialog>
    </>}
  </div>
}
