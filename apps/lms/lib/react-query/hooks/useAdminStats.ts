import { useAppQuery } from "./useAppCache"

export interface AdminStats {
  totalLearners: number
  totalCourses: number
  totalRevenue: number
  revenueCurrency: string
  totalCompleted: number
  recentActivity: Array<{
    id: string
    type: "signup" | "enrollment" | "completion" | "payment"
    user: string
    course: string
    amount?: string
    time: string
    timestamp: number
  }>
}

// Fetch admin dashboard stats
export function useAdminStats() {
  return useAppQuery<AdminStats>(
    'adminStats',
    ["admin-stats"],
    async () => {
      const response = await fetch("/api/admin/stats")
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to fetch admin stats")
      }
      return response.json()
    }
  )
}

