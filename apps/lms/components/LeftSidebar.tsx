"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Home,
  BookOpen,
  HelpCircle,
  Users,
  BarChart,
  User,
  Settings,
  LogOut,
  Target,
  ClipboardCheck,
  Clock,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import Logo from "./Logo"
import { ThemeToggle } from "./ThemeToggle"
import { logout } from "../utils/logout"
import CopyrightText from "./CopyrightText"
import Indicator from "./Indicator"

interface LeftSidebarProps {
  userType: "user" | "admin" | "instructor" | "leadership"
  isLeadership?: boolean
  isFeedbackLeader?: boolean
}

interface MenuItem {
  href: string
  icon: LucideIcon
  label: string
  external?: boolean
  isLogout?: boolean
}

export default function LeftSidebar({ userType, isLeadership = false, isFeedbackLeader = false }: LeftSidebarProps) {
  const pathname = usePathname()

  // Build admin/instructor menu items
  const menuItems: MenuItem[] = [
    { href: "/pd", icon: Home, label: "My PD" },
    { href: "/pd/goals", icon: Target, label: "My Goals" },
    { href: "/pd/observations", icon: ClipboardCheck, label: "Observations" },
    { href: "/pd/cpd", icon: Clock, label: "CPD Log" },
    { href: "/learner/courses", icon: BookOpen, label: "Training Courses" },
  ]

  if (isFeedbackLeader || userType === "admin") menuItems.push({ href: "/pd/team", icon: Users, label: "My Team" })

  if (userType === "admin") {
    menuItems.push(
      { href: "/pd/admin/staff", icon: Users, label: "Staff" },
      { href: "/pd/admin/leaders", icon: Users, label: "Feedback Leaders" },
      { href: "/pd/admin/school-goals", icon: Target, label: "School Goals" },
      { href: "/pd/admin/forms", icon: ClipboardCheck, label: "Observation Forms" },
      { href: "/pd/admin/cpd", icon: Clock, label: "Bulk CPD" },
      { href: "/pd/admin/reports", icon: BarChart, label: "Reports" },
      { href: "/pd/admin/settings", icon: Settings, label: "Years & Settings" },
      { href: "/admin/courses", icon: BookOpen, label: "Training admin" },
    )
  } else if (isLeadership) {
    menuItems.push({ href: "/pd/admin/reports", icon: BarChart, label: "Reports" })
  }

  const bottomMenuItems: Record<"user" | "admin", MenuItem[]> = {
    user: [
      { href: "/learner/profile", icon: User, label: "Profile" },
      { href: "#", icon: LogOut, label: "Log Out", isLogout: true },
    ],
    admin: [
      { href: "/admin/profile", icon: User, label: "Profile" },
      { href: "/admin/settings", icon: Settings, label: "Training Settings" },
      { href: "#", icon: LogOut, label: "Log Out", isLogout: true },
    ],
  }

  const currentMenu = menuItems
  const currentBottomMenu = bottomMenuItems[userType === "admin" ? "admin" : "user"]

  return (
    <div className="w-64 h-screen py-4 flex-col fixed left-0 top-0 bg-background-element border-r border-border hidden lg:flex">
      <div className="mb-8 px-6">
        <Logo className="w-56" />
      </div>
      <nav className="flex-grow px-2">
        {currentMenu.map((item) => {
          const isActive = pathname === item.href
          return item.external ? (
            <a href={item.href} key={item.href} target="_blank" rel="noopener noreferrer">
              <Button
                variant="ghost"
                className={`w-full justify-start mb-2 ${
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <item.icon className={`mr-2 h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                {item.label}
              </Button>
            </a>
          ) : (
            <Button
              key={item.href}
              variant="ghost"
              className={`w-full justify-start mb-2 ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              asChild
            >
              <Link href={item.href} prefetch={true}>
                <>
                  <item.icon className={`mr-2 h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                  {item.label}
                </>
              </Link>
            </Button>
          )
        })}
      </nav>
      <div className="mt-auto px-2 border-t border-border pt-4">
        {currentBottomMenu.map((item) => {
          const isActive = pathname === item.href
          if (item.isLogout) {
            return (
              <Button
                key={item.href}
                variant="ghost"
                onClick={() => logout(userType)}
                className="w-full justify-start mb-2 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </Button>
            )
          }
          return (
            <Button
              key={item.href}
              variant="ghost"
              className={`w-full justify-start mb-2 ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              asChild
            >
              <Link href={item.href} prefetch={true}>
                <>
                  <item.icon className={`mr-2 h-4 w-4 ${isActive ? "text-primary" : ""}`} />
                  {item.label}
                </>
              </Link>
            </Button>
          )
        })}
        <div className="mt-4 flex justify-center mb-4">
          <ThemeToggle />
        </div>
        <div className="px-4 pb-4">
          <CopyrightText />
          <Indicator />
        </div>
      </div>
    </div>
  )
}
