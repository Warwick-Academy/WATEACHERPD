"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Search, Upload } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import type { PdProfile } from "@/lib/pd/types"

type StaffRow = PdProfile & { role?: string }

export default function StaffAdminPage() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<StaffRow | null>(null)
  const [edit, setEdit] = useState<Partial<StaffRow>>({})
  const [csvRows, setCsvRows] = useState<any[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResults, setImportResults] = useState<any[] | null>(null)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/pd/admin/staff", { cache: "no-store" })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "Failed to load staff")
    setStaff(body.staff)
    setLoading(false)
  }

  useEffect(() => { load().catch((error) => { toast.error(error.message); setLoading(false) }) }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return staff.filter((person) =>
      !term || [person.name, person.email, person.department, person.job_title].some((value) =>
        String(value ?? "").toLowerCase().includes(term)
      )
    )
  }, [staff, search])

  function openEdit(person: StaffRow) {
    setSelected(person)
    setEdit({ ...person })
  }

  async function saveEdit() {
    if (!selected) return
    const response = await fetch("/api/pd/admin/staff", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edit),
    })
    const body = await response.json()
    if (!response.ok) { toast.error(body.error || "Could not save staff"); return }
    toast.success("Staff details saved")
    setSelected(null)
    await load()
  }

  async function readCsv(file?: File) {
    if (!file) return
    if (file.size > 1024 * 1024) { toast.error("CSV must be no larger than 1 MB"); return }
    const text = await file.text()
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim())
    if (!lines.length) return
    const headers = lines.shift()!.split(",").map((value) => value.trim().toLowerCase())
    if (!headers.includes("name") || !headers.includes("email")) {
      toast.error("CSV must include name and email columns")
      return
    }
    const existing = new Set(staff.map((person) => person.email.toLowerCase()))
    const parsed = lines.map((line) => {
      const cells = line.split(",").map((value) => value.trim())
      const row: any = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
      let error = ""
      if (!row.name) error = "Name is required"
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) || !row.email.toLowerCase().endsWith("@warwick.bm")) error = "Use a valid @warwick.bm email"
      else if (!["", "primary", "secondary", "both"].includes(String(row.phase ?? "").toLowerCase())) error = "Phase must be primary, secondary or both"
      else if (existing.has(row.email.toLowerCase())) error = "Email already exists"
      return { ...row, email: row.email.toLowerCase(), phase: row.phase?.toLowerCase() || "secondary", error }
    })
    setCsvRows(parsed)
  }

  async function importCsv() {
    setImporting(true)
    setImportResults(null)
    const response = await fetch("/api/pd/admin/staff/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: csvRows.filter((row) => !row.error) }),
    })
    const body = await response.json()
    if (!response.ok) { toast.error(body.error || "Import failed"); setImporting(false); return }
    setImportResults(body.results)
    await load()
    setImporting(false)
  }

  function downloadResults() {
    if (!importResults) return
    const escape = (value: string) => `"${String(value ?? "").replace(/"/g, '""')}"`
    const csv = ["name,email,password,status", ...importResults.map((row) =>
      [row.name, row.email, row.password ?? "", row.status].map(escape).join(",")
    )].join("\r\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "staff-import-results.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-semibold sm:text-3xl">Staff</h1><p className="text-sm text-muted-foreground">Manage Warwick Academy staff profiles.</p></div>
        <Button variant="outline" onClick={() => { setImportOpen(true); setImportResults(null); setCsvRows([]) }}><Upload className="mr-2 h-4 w-4" />Import CSV</Button>
      </div>

      <Card>
        <CardHeader><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search staff..." value={search} onChange={(event) => setSearch(event.target.value)} /></div></CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Department</TableHead><TableHead>Phase</TableHead><TableHead>Status</TableHead><TableHead>Preview</TableHead></TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={7}>Loading...</TableCell></TableRow> : filtered.map((person) => (
                  <TableRow key={person.id} className="cursor-pointer" onClick={() => openEdit(person)}>
                    <TableCell className="font-medium">{person.name}</TableCell>
                    <TableCell>{person.email}</TableCell>
                    <TableCell>{person.user_type}</TableCell>
                    <TableCell>{person.department || "—"}</TableCell>
                    <TableCell>{person.phase}</TableCell>
                    <TableCell><Badge variant={person.is_active ? "default" : "secondary"}>{person.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><Button asChild size="sm" variant="outline"><Link href={`/pd/admin/staff/${person.id}/preview`} onClick={(event) => event.stopPropagation()} aria-label={`Preview ${person.name}'s account`}>Preview</Link></Button></TableCell>
                  </TableRow>
                ))}
                {!loading && !filtered.length && <TableRow><TableCell colSpan={7}>No staff found.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>Edit staff</SheetTitle><SheetDescription>Changes are controlled by Warwick Academy administrators.</SheetDescription></SheetHeader>
          <div className="grid gap-4 py-6">
            <div className="grid gap-2"><Label>Name</Label><Input value={edit.name ?? ""} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></div>
            <div className="grid gap-2"><Label>Email</Label><Input value={edit.email ?? ""} readOnly /></div>
            <div className="grid gap-2"><Label>Job title</Label><Input value={edit.job_title ?? ""} onChange={(event) => setEdit({ ...edit, job_title: event.target.value })} /></div>
            <div className="grid gap-2"><Label>Department</Label><Input value={edit.department ?? ""} onChange={(event) => setEdit({ ...edit, department: event.target.value })} /></div>
            <div className="grid gap-2"><Label>Phase</Label><Select value={edit.phase ?? "secondary"} onValueChange={(phase: "primary" | "secondary" | "both") => setEdit({ ...edit, phase })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="primary">Primary</SelectItem><SelectItem value="secondary">Secondary</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent></Select></div>
            <div className="grid gap-2"><Label>Role</Label><Select value={edit.user_type ?? "user"} onValueChange={(user_type: "user" | "admin" | "instructor" | "leadership") => setEdit({ ...edit, user_type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">Staff</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="instructor">Instructor</SelectItem><SelectItem value="leadership">Leadership</SelectItem></SelectContent></Select></div>
            <div className="flex items-center gap-2"><Checkbox checked={Boolean(edit.is_active)} onCheckedChange={(checked) => setEdit({ ...edit, is_active: checked === true })} /><Label>Active</Label></div>
          </div>
          <SheetFooter>
            {selected && <Button asChild variant="outline"><Link href={`/pd/admin/staff/${selected.id}/preview`}>Preview account</Link></Button>}
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button onClick={saveEdit}>Save</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>Import staff from CSV</SheetTitle><SheetDescription>Required columns: name,email. Optional: job_title,department,phase.</SheetDescription></SheetHeader>
          {!importResults ? (
            <div className="grid gap-4 py-6">
              <Input type="file" accept=".csv,text/csv" onChange={(event) => readCsv(event.target.files?.[0])} />
              {csvRows.length > 0 && <div className="max-h-80 overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{csvRows.map((row, index) => <TableRow key={index}><TableCell>{row.name}</TableCell><TableCell>{row.email}</TableCell><TableCell className={row.error ? "text-destructive" : ""}>{row.error || "Ready"}</TableCell></TableRow>)}</TableBody></Table></div>}
              <Button onClick={importCsv} disabled={importing || !csvRows.some((row) => !row.error)}>{importing ? "Importing..." : "Create valid accounts"}</Button>
            </div>
          ) : (
            <div className="grid gap-4 py-6"><p className="text-sm">Download the results and transfer passwords securely.</p><Table><TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{importResults.map((row, index) => <TableRow key={index}><TableCell>{row.email}</TableCell><TableCell>{row.status}</TableCell></TableRow>)}</TableBody></Table><SheetFooter><Button onClick={downloadResults}>Download results CSV</Button><Button variant="outline" onClick={() => setImportOpen(false)}>Done</Button></SheetFooter></div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
