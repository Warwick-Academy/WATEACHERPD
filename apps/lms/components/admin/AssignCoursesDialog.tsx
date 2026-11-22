"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { assignCourses, type AssignmentLearner } from "@/lib/admin/assignments"
import CourseSelector from "./CourseSelector"
import { toast } from "sonner"

export default function AssignCoursesDialog({ open, onOpenChange, learners }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  learners: AssignmentLearner[]
}) {
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const queryClient = useQueryClient()
  const assignedCounts: Record<number, number> = {}
  learners.forEach((learner) => learner.enrolledCourses.forEach((id) => { assignedCounts[id] = (assignedCounts[id] || 0) + 1 }))

  const changeOpen = (next: boolean) => {
    if (busy) return
    if (!next) { setSelected([]); setErrors([]) }
    onOpenChange(next)
  }
  const submit = async () => {
    setBusy(true)
    setErrors([])
    const result = await assignCourses(learners, selected)
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
      toast.success(`${result.assigned} course assignment${result.assigned === 1 ? "" : "s"} completed.`)
      changeOpen(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign Courses</DialogTitle>
          <DialogDescription>Assign published courses to {learners.length === 1 ? learners[0].name : `${learners.length} selected teachers`}. Existing assignments will be skipped.</DialogDescription>
        </DialogHeader>
        <CourseSelector selected={selected} onChange={setSelected} assignedCounts={assignedCounts} learnerCount={learners.length} disabled={busy} />
        {errors.length > 0 && <div role="alert" className="text-sm text-destructive"><p>Some assignments failed:</p><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !selected.length || !learners.length}>{busy ? "Assigning..." : "Assign Courses"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
