"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { assignCourses } from "@/lib/admin/assignments"
import { exportUserResults, parseUserCsv, type ImportRow } from "@/lib/admin/user-import"
import CourseSelector from "./CourseSelector"
import { toast } from "sonner"

type ImportResult = { name: string; email: string; password: string; status: string }

export default function ImportUsersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rows, setRows] = useState<ImportRow[]>([])
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [courses, setCourses] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const queryClient = useQueryClient()
  const changeOpen = (next: boolean) => {
    if (busy) return
    if (!next) { setRows([]); setResults(null); setCourses([]); setError("") }
    onOpenChange(next)
  }
  const loadFile = async (file?: File) => {
    setRows([]); setError("")
    if (!file) return
    if (file.size > 1024 * 1024) { setError("CSV must be no larger than 1 MB."); return }
    setBusy(true)
    try {
      const response = await fetch("/api/users", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to check existing users")
      setRows(parseUserCsv(await file.text(), data.users.map((user: { email: string }) => user.email)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to read CSV")
    } finally { setBusy(false) }
  }
  const submit = async () => {
    setBusy(true); setError("")
    const output: ImportResult[] = []
    setResults([])
    for (const row of rows) {
      let result: ImportResult = { name: row.name, email: row.email, password: "", status: row.error || "Not imported" }
      if (!row.error) {
        try {
          const response = await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: row.name, email: row.email, userType: row.userType, generatePassword: true }),
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || "Failed to create user")
          result = { name: row.name, email: row.email, password: data.temporaryPassword, status: "Created" }
          output.push(result)
          setResults([...output])
          const assignment = await assignCourses([{ id: data.user.id, name: row.name, enrolledCourses: [] }], courses)
          if (assignment.failures.length) result.status = `Created; assignment failed: ${assignment.failures.join("; ")}`
          setResults([...output])
          continue
        } catch (caught) {
          result.status = caught instanceof Error ? caught.message : "Failed to create user"
        }
      }
      output.push(result)
      setResults([...output])
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["learners"] }),
      queryClient.invalidateQueries({ queryKey: ["learner-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["platformUsers"] }),
      queryClient.invalidateQueries({ queryKey: ["teamMembers"] }),
      queryClient.invalidateQueries({ queryKey: ["courses"] }),
    ])
    setBusy(false)
    toast.success("Import finished. Download the results before closing.")
  }
  const download = () => {
    if (!results) return
    const url = URL.createObjectURL(new Blob([exportUserResults(results)], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url; link.download = "staff-import-results.csv"; link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import CSV</DialogTitle><DialogDescription>Upload a CSV with name,email and optional role (teacher or admin). Invalid rows will be skipped.</DialogDescription></DialogHeader>
        {!results ? (
          <div className="space-y-4">
            <Input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(event) => loadFile(event.target.files?.[0])} disabled={busy} />
            {rows.length > 0 && <>
              <div className="max-h-56 overflow-auto rounded-md border">
                <table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Name</th><th className="p-2 text-left">Email</th><th className="p-2 text-left">Role</th><th className="p-2 text-left">Status</th></tr></thead>
                  <tbody>{rows.map((row, index) => <tr key={index} className="border-t"><td className="p-2">{row.name}</td><td className="p-2">{row.email}</td><td className="p-2">{row.userType === "admin" ? "Admin" : "Teacher"}</td><td className={`p-2 ${row.error ? "text-destructive" : ""}`}>{row.error || "Ready"}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="space-y-2"><Label>Assign these courses to imported users (optional)</Label><CourseSelector selected={courses} onChange={setCourses} disabled={busy} /></div>
            </>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button variant="outline" onClick={() => changeOpen(false)} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy || !rows.some((row) => !row.error)}>{busy ? "Working..." : "Import valid rows"}</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">Download and securely distribute the temporary passwords. They cannot be shown again after closing.</p>
            <div className="max-h-56 overflow-auto rounded-md border"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Email</th><th className="p-2 text-left">Status</th></tr></thead><tbody>
              {results.map((result, index) => <tr key={index} className="border-t"><td className="p-2">{result.email}</td><td className="p-2">{result.status}</td></tr>)}
            </tbody></table></div>
            <DialogFooter><Button onClick={download} disabled={!results.length}>Download results CSV</Button><Button variant="outline" onClick={() => changeOpen(false)} disabled={busy}>Done</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
