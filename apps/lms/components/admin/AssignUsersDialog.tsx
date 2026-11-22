"use client"

import { useId, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLearners } from "@/lib/react-query/hooks"
import type { Learner } from "@/lib/react-query/hooks/useLearners"
import { assignCourses } from "@/lib/admin/assignments"
import { toast } from "sonner"

export default function AssignUsersDialog({ course, open, onOpenChange }: {
  course: { id: number; title: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data, isPending, error } = useLearners()
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const queryClient = useQueryClient()
  const id = useId()
  const learners: Learner[] = data?.learners || []
  const available = learners.filter((learner) => course && !(learner.enrolledCourses || []).includes(course.id))
  const visible = learners.filter((learner) => `${learner.name} ${learner.email}`.toLowerCase().includes(search.toLowerCase()))
  const changeOpen = (next: boolean) => {
    if (busy) return
    if (!next) { setSelected([]); setSearch(""); setErrors([]) }
    onOpenChange(next)
  }
  const submit = async () => {
    if (!course) return
    setBusy(true); setErrors([])
    const result = await assignCourses(learners.filter((learner) => selected.includes(learner.id)).map((learner) => ({
      id: learner.id, name: learner.name, enrolledCourses: learner.enrolledCourses || [],
    })), [course.id])
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["learners"] }),
      queryClient.invalidateQueries({ queryKey: ["learner"] }),
      queryClient.invalidateQueries({ queryKey: ["learner-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["courses"] }),
    ])
    setBusy(false)
    if (result.failures.length) {
      setErrors(result.failures)
      toast.error(`${result.assigned} assignments completed; ${result.failures.length} failed.`)
    } else {
      toast.success(`${result.assigned} teacher${result.assigned === 1 ? "" : "s"} assigned.`)
      changeOpen(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Assign to users</DialogTitle><DialogDescription>Select teachers to assign {course?.title}.</DialogDescription></DialogHeader>
        <Input aria-label="Search teachers" placeholder="Search teachers" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="flex items-center gap-2"><Checkbox id={`${id}-all`} checked={available.length > 0 && available.every((learner) => selected.includes(learner.id))}
          onCheckedChange={(checked) => setSelected(checked === true ? available.map((learner) => learner.id) : [])} disabled={busy || !available.length} />
          <Label htmlFor={`${id}-all`}>Select all teachers</Label></div>
        {isPending ? <p>Loading teachers...</p> : error ? <p role="alert" className="text-sm text-destructive">{error.message}</p> :
          <div className="max-h-56 overflow-y-auto rounded-md border p-3 space-y-2">
            {visible.length === 0 && <p className="text-sm text-muted-foreground">No teachers found.</p>}
            {visible.map((learner) => {
              const assigned = !!course && (learner.enrolledCourses || []).includes(course.id)
              return <div key={learner.id} className="flex items-center gap-2">
                <Checkbox id={`${id}-${learner.id}`} checked={assigned || selected.includes(learner.id)} disabled={busy || assigned}
                  onCheckedChange={(checked) => setSelected(checked === true ? [...selected, learner.id] : selected.filter((item) => item !== learner.id))} />
                <Label htmlFor={`${id}-${learner.id}`}>{learner.name} ({learner.email}){assigned ? " — already assigned" : ""}</Label>
              </div>
            })}
          </div>}
        {errors.length > 0 && <div role="alert" className="text-sm text-destructive"><p>Some assignments failed:</p><ul>{errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        <DialogFooter><Button variant="outline" onClick={() => changeOpen(false)} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy || !selected.length}>{busy ? "Assigning..." : "Assign Courses"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
