"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Search, Mail, BookOpen, Award, TrendingUp, Filter, Plus, Loader2 } from "lucide-react"
import AdminLearnersSkeleton from "@/components/AdminLearnersSkeleton"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import { useClientAuthState } from "@/utils/client-auth"
import { useLearners, useRealtimeAdminStats } from "@/lib/react-query/hooks"
import AddUserDialog from "@/components/admin/AddUserDialog"
import ImportUsersDialog from "@/components/admin/ImportUsersDialog"
import AssignCoursesDialog from "@/components/admin/AssignCoursesDialog"
import type { AssignmentLearner } from "@/lib/admin/assignments"
import type { Learner as ApiLearner } from "@/lib/react-query/hooks/useLearners"

interface Learner {
  id: string
  name: string
  email: string
  profileImage: string
  enrolledCourses: number[]
  completedCourses: number[]
  progress: { [courseId: number]: number }
}

export default function LearnersPage() {
  const router = useRouter()
  const { user, loading: authLoading, userType } = useClientAuthState()
  const [searchTerm, setSearchTerm] = useState("")
  const [enrollmentFilter, setEnrollmentFilter] = useState<string>("all")
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignmentTargets, setAssignmentTargets] = useState<AssignmentLearner[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mounted, setMounted] = useState(false)

  // Use React Query hooks for data fetching with caching
  const { data: learnersData, isPending: learnersPending, error: learnersError } = useLearners({
    search: searchTerm || undefined,
    enrollmentFilter: enrollmentFilter !== "all" ? enrollmentFilter : undefined,
  })
  
  const { data: allLearnersData } = useLearners()
  const allLearners: ApiLearner[] = allLearnersData?.learners || []
  const { data: stats, isPending: statsPending, error: statsError } = useQuery({
    queryKey: ["learner-stats"],
    queryFn: async (): Promise<{ totalLearners: number; totalEnrollments: number; totalCompleted: number }> => {
      const response = await fetch("/api/admin/learner-stats")
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Failed to load learner statistics")
      return result
    },
  })
  
  // Set up real-time subscription for admin stats (which also affects learners)
  useRealtimeAdminStats()
  
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!authLoading) {
      const isAdmin = userType === "admin"
      if (!user || !isAdmin) {
        router.push("/auth/admin/login")
      }
    }
  }, [user, userType, authLoading, router])

  // Process learners data from React Query
  const learners = useMemo<Learner[]>(() => {
    if (!learnersData?.learners) return []
    return learnersData.learners.map((learner: any) => ({
      id: learner.id,
      name: learner.name,
      email: learner.email,
      profileImage: learner.profileImage || learner.profile_image || "",
      enrolledCourses: learner.enrolledCourses || [],
      completedCourses: learner.completedCourses || [],
      progress: learner.progress || {},
    }))
  }, [learnersData])

  // API already handles filtering, so filteredLearners is just the learners
  const filteredLearners = learners

  // Show skeleton ONLY on true initial load (no cached data exists)
  // Once we have data, never show skeleton again (even during refetches)
  // Show cached data instantly even if isPending is true
  const hasCachedData = !!learnersData?.learners
  const showSkeleton = (authLoading || !user || userType !== "admin") && !hasCachedData && learnersPending
  const openAssignments = (targets: AssignmentLearner[]) => { setAssignmentTargets(targets); setAssignOpen(true) }

  // Show skeleton ONLY on true initial load (no cached data exists)
  // Once we have data, never show skeleton again (even during refetches)
  // Show cached data instantly even if isPending is true
  // Note: hasCachedData is already defined above

  return (
    <div className="pt-4 md:pt-8 pb-[30px] md:pb-8 px-4 lg:px-6">
      {showSkeleton ? (
        <AdminLearnersSkeleton />
      ) : (
        <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-primary mb-2">Learner Management</h1>
          <p className="text-muted-foreground">
            View and manage all teachers and their course assignments
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>Import CSV</Button>
          <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-2" />Add User</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <Mail className="mr-2 h-4 w-4" />
              Total Learners
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsPending ? (
              <div className="flex items-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : statsError ? (
              <p className="text-sm text-destructive">Error loading stats</p>
            ) : (
              <p className="text-3xl font-bold">{stats?.totalLearners ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <BookOpen className="mr-2 h-4 w-4" />
              Total Enrollments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsError ? <p className="text-sm text-destructive">Error loading stats</p> : <p className="text-3xl font-bold">{stats?.totalEnrollments ?? "..."}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-base">
              <Award className="mr-2 h-4 w-4" />
              Completed Courses
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsError ? <p className="text-sm text-destructive">Error loading stats</p> : <p className="text-3xl font-bold">{stats?.totalCompleted ?? "..."}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <CardTitle>All Learners</CardTitle>
            <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
              <Button variant="outline" disabled={!selectedIds.length} onClick={() => openAssignments(
                allLearners.filter((learner) => selectedIds.includes(learner.id)).map((learner) => ({
                  id: learner.id, name: learner.name, enrolledCourses: learner.enrolledCourses || [],
                }))
              )}>Assign Courses ({selectedIds.length})</Button>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={enrollmentFilter} onValueChange={setEnrollmentFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Learners</SelectItem>
                  <SelectItem value="enrolled">Enrolled</SelectItem>
                  <SelectItem value="not-enrolled">Not Enrolled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><Checkbox aria-label="Select all visible learners" checked={filteredLearners.length > 0 && filteredLearners.every((learner) => selectedIds.includes(learner.id))}
                    onCheckedChange={(checked) => setSelectedIds(checked === true
                      ? Array.from(new Set([...selectedIds, ...filteredLearners.map((learner) => learner.id)]))
                      : selectedIds.filter((id) => !filteredLearners.some((learner) => learner.id === id)))} /></TableHead>
                  <TableHead className="w-[35%] min-w-[200px]">Learner</TableHead>
                  <TableHead className="w-[35%] min-w-[180px]">Email</TableHead>
                  <TableHead className="w-[30%] min-w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {learnersError ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-destructive">
                      {learnersError.message || "Failed to load learners"}
                    </TableCell>
                  </TableRow>
                ) : filteredLearners.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No learners found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLearners.map((learner) => (
                    <TableRow key={learner.id}>
                      <TableCell><Checkbox aria-label={`Select ${learner.name}`} checked={selectedIds.includes(learner.id)}
                        onCheckedChange={(checked) => setSelectedIds(checked === true ? [...selectedIds, learner.id] : selectedIds.filter((id) => id !== learner.id))} /></TableCell>
                      <TableCell className="w-[35%] min-w-[200px]">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 flex-shrink-0">
                            <AvatarImage src={learner.profileImage} alt={learner.name} />
                            <AvatarFallback>{learner.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{learner.name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="w-[35%] min-w-[180px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <Mail className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-sm truncate">{learner.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="w-[30%] min-w-[180px]">
                        <div className="flex gap-2 flex-wrap">
                          <Link href={`/admin/learners/${learner.id}`}>
                            <Button variant="outline" size="sm" className="whitespace-nowrap">
                              View Details
                            </Button>
                          </Link>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openAssignments([learner])}
                            className="whitespace-nowrap"
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Assign Courses
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportUsersDialog open={importOpen} onOpenChange={setImportOpen} />
      <AssignCoursesDialog open={assignOpen} onOpenChange={setAssignOpen} learners={assignmentTargets} />
        </>
      )}
    </div>
  )
}
