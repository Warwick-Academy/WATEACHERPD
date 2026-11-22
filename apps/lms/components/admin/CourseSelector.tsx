"use client"

import { useId, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCourses } from "@/lib/react-query/hooks"
import type { Course } from "@/lib/react-query/hooks/useCourses"

export default function CourseSelector({
  selected, onChange, assignedCounts = {}, learnerCount = 0, disabled = false,
}: {
  selected: number[]
  onChange: (selected: number[]) => void
  assignedCounts?: Record<number, number>
  learnerCount?: number
  disabled?: boolean
}) {
  const { data, isPending, error } = useCourses()
  const [search, setSearch] = useState("")
  const id = useId()
  const allCourses: Course[] = data?.courses || []
  const courses = allCourses.filter((course) => course.title.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="space-y-2">
      <Input aria-label="Search courses" placeholder="Search published courses" value={search} onChange={(event) => setSearch(event.target.value)} />
      {isPending ? <p className="text-sm text-muted-foreground">Loading courses...</p> :
        error ? <p role="alert" className="text-sm text-destructive">Unable to load courses: {error.message}</p> :
        courses.length === 0 ? <p className="text-sm text-muted-foreground">No published courses found.</p> :
        <div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-3">
          {courses.map((course) => {
            const count = assignedCounts[course.id] || 0
            const allAssigned = learnerCount > 0 && count === learnerCount
            return (
              <div key={course.id} className="flex items-start gap-2">
                <Checkbox id={`${id}-${course.id}`} checked={allAssigned || selected.includes(course.id)} disabled={disabled || allAssigned}
                  onCheckedChange={(checked) => onChange(checked === true ? [...selected, course.id] : selected.filter((item) => item !== course.id))} />
                <Label htmlFor={`${id}-${course.id}`} className="leading-normal">
                  {course.title}{allAssigned ? " (already assigned)" : count > 0 ? ` (${count} already assigned)` : ""}
                </Label>
              </div>
            )
          })}
        </div>}
    </div>
  )
}
