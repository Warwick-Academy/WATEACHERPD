"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import type { PdProfile } from "@/lib/pd/types"

export default function FeedbackLeadersPage() {
  const [staff, setStaff] = useState<PdProfile[]>([])
  const [assignments, setAssignments] = useState<{ staff_id: string; leader_id: string; is_lead: boolean }[]>([])
  const [search, setSearch] = useState("")
  const [department, setDepartment] = useState("all")
  const [leaderId, setLeaderId] = useState("")
  const [isLead, setIsLead] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  async function load() {
    const [staffResponse, assignmentResponse] = await Promise.all([
      fetch("/api/pd/admin/staff", { cache: "no-store" }),
      fetch("/api/pd/admin/leaders", { cache: "no-store" }),
    ])
    const staffBody = await staffResponse.json()
    const assignmentBody = await assignmentResponse.json()
    if (!staffResponse.ok) throw new Error(staffBody.error || "Failed to load staff")
    if (!assignmentResponse.ok) throw new Error(assignmentBody.error || "Failed to load assignments")
    setStaff(staffBody.staff.filter((person: PdProfile) => person.is_active))
    setAssignments(assignmentBody.assignments ?? [])
  }

  useEffect(() => { load().catch((error) => toast.error(error.message)) }, [])

  const departments = useMemo(() => [...new Set(staff.map((person) => person.department).filter(Boolean))] as string[], [staff])
  const visible = useMemo(() => staff.filter((person) =>
    (department === "all" || person.department === department) &&
    (!search || [person.name, person.email].some((value) => String(value ?? "").toLowerCase().includes(search.toLowerCase())))
  ), [staff, department, search])
  const leaders = useMemo(() => staff.filter((person) =>
    assignments.some((assignment) => assignment.leader_id === person.id)
  ).concat(staff.filter((person) => !assignments.some((assignment) => assignment.leader_id === person.id))), [staff, assignments])
  const noLeader = staff.filter((person) => !assignments.some((assignment) => assignment.staff_id === person.id))

  async function assign() {
    if (!selected.length || !leaderId) { toast.error("Select staff and a Feedback Leader"); return }
    const response = await fetch("/api/pd/admin/leaders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", staffIds: selected, leaderId, isLead }),
    })
    const body = await response.json()
    if (!response.ok) { toast.error(body.error || "Could not assign"); return }
    toast.success(`Assigned ${body.assigned} staff member${body.assigned === 1 ? "" : "s"}`)
    setSelected([])
    await load()
  }

  async function remove(staffId: string, leaderIdToRemove: string) {
    await fetch("/api/pd/admin/leaders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", staffId, leaderId: leaderIdToRemove }),
    })
    await load()
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div><h1 className="text-2xl font-semibold sm:text-3xl">Feedback Leaders</h1><p className="text-sm text-muted-foreground">Manage staff assignments for the current academic year.</p></div>
      {noLeader.length > 0 && <Card className="border-amber-300"><CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700"><AlertTriangle className="h-4 w-4" />Staff with no Feedback Leader</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">{noLeader.map((person) => <Badge key={person.id} variant="outline">{person.name}</Badge>)}</CardContent></Card>}
      <Card>
        <CardHeader><CardTitle className="text-base">Bulk assign</CardTitle></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_220px_220px_auto] lg:items-end">
          <div className="grid gap-2"><Label>Search and department</Label><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff" /></div><Select value={department} onValueChange={setDepartment}><SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All departments</SelectItem>{departments.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div></div>
          <div className="grid gap-2"><Label>Feedback Leader</Label><Select value={leaderId} onValueChange={setLeaderId}><SelectTrigger><SelectValue placeholder="Choose leader" /></SelectTrigger><SelectContent>{staff.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex h-10 items-center gap-2"><Checkbox checked={isLead} onCheckedChange={(checked) => setIsLead(checked === true)} /><Label>Lead appraiser</Label></div>
          <Button onClick={assign} disabled={!selected.length || !leaderId}>Assign ({selected.length})</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border"><Table><TableHeader><TableRow><TableHead className="w-12"><Checkbox checked={visible.length > 0 && visible.every((person) => selected.includes(person.id))} onCheckedChange={(checked) => setSelected(checked ? visible.map((person) => person.id) : [])} /></TableHead><TableHead>Staff</TableHead><TableHead>Department</TableHead><TableHead>Feedback Leaders</TableHead></TableRow></TableHeader><TableBody>{visible.map((person) => {
            const personAssignments = assignments.filter((assignment) => assignment.staff_id === person.id)
            return <TableRow key={person.id}><TableCell><Checkbox checked={selected.includes(person.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, person.id] : current.filter((id) => id !== person.id))} /></TableCell><TableCell className="font-medium">{person.name}</TableCell><TableCell>{person.department || "—"}</TableCell><TableCell><div className="flex flex-wrap gap-2">{personAssignments.length ? personAssignments.map((assignment) => <Badge key={assignment.leader_id} variant={assignment.is_lead ? "default" : "secondary"}>{staff.find((leader) => leader.id === assignment.leader_id)?.name || "Leader"}{assignment.is_lead ? " • Lead" : ""}<button className="ml-2" onClick={() => remove(person.id, assignment.leader_id)} aria-label="Remove leader">×</button></Badge>) : <span className="text-muted-foreground">None</span>}</div></TableCell></TableRow>
          })}</TableBody></Table></div>
        </CardContent>
      </Card>
    </div>
  )
}
