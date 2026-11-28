"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"

export default function PdSettingsPage() {
  const [year, setYear] = useState<any>(null)
  const [target, setTarget] = useState("30")
  const [maxGoals, setMaxGoals] = useState("3")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [copyAssignments, setCopyAssignments] = useState(true)

  async function load() {
    const response = await fetch("/api/pd/admin/settings", { cache: "no-store" })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Failed to load settings")
    setYear(body.year)
    setTarget(String(body.settings?.annual_cpd_target_hours ?? 30))
    setMaxGoals(String(body.settings?.max_goals_per_year ?? 3))
  }

  useEffect(() => { load().catch((error) => toast.error(error.message)) }, [])

  async function saveSettings() {
    const response = await fetch("/api/pd/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annual_cpd_target_hours: target, max_goals_per_year: maxGoals }),
    })
    const body = await response.json()
    if (!response.ok) { toast.error(body.error || "Could not save settings"); return }
    toast.success("Settings saved")
  }

  async function startYear() {
    if (!name || !start || !end || end <= start) { toast.error("Enter a name and valid start and end dates"); return }
    const response = await fetch("/api/pd/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, start_date: start, end_date: end, copy_assignments: copyAssignments }),
    })
    const body = await response.json()
    if (!response.ok) { toast.error(body.error || "Could not start academic year"); return }
    toast.success("New academic year started")
    setOpen(false)
    await load()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div><h1 className="text-2xl font-semibold sm:text-3xl">Years &amp; Settings</h1><p className="text-sm text-muted-foreground">Manage the current academic year and PD limits.</p></div>
      <Card><CardHeader><CardTitle>Current academic year</CardTitle></CardHeader><CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{year?.name || "Loading..."}</p><p className="text-sm text-muted-foreground">{year?.start_date} to {year?.end_date}</p></div><Button onClick={() => setOpen(true)}>Start new academic year</Button></CardContent></Card>
      <Card><CardHeader><CardTitle>PD settings</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Annual CPD target hours</Label><Input type="number" min="0.25" step="0.25" value={target} onChange={(event) => setTarget(event.target.value)} /></div><div className="grid gap-2"><Label>Maximum goals per year</Label><Input type="number" min="1" max="10" value={maxGoals} onChange={(event) => setMaxGoals(event.target.value)} /></div><div className="sm:col-span-2"><Button onClick={saveSettings}>Save settings</Button></div></CardContent></Card>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Start new academic year</DialogTitle><DialogDescription>The old year will become read-only history. The new year will become current.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label>Name</Label><Input placeholder="2027–28" value={name} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-2"><Label>Start date</Label><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></div><div className="grid gap-2"><Label>End date</Label><Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></div><div className="flex items-center gap-2"><Checkbox checked={copyAssignments} onCheckedChange={(checked) => setCopyAssignments(checked === true)} /><Label>Copy this year&apos;s Feedback Leader assignments</Label></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={startYear}>Start year</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
