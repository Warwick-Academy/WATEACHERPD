"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  BookOpen,
  MessageSquare,
  BarChart,
  Users,
  User,
  HelpCircle,
  Settings,
  LogOut,
  Clock,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ThemeToggle } from "./ThemeToggle"
import Logo from "./Logo"
import { logout } from "../utils/logout"
import { Skeleton } from "@/components/ui/skeleton"

interface MobileMenuProps {
  userType: "user" | "admin" | "instructor" | "leadership"
  isLeadership?: boolean
  isFeedbackLeader?: boolean
  user?: {
    name: string
    profileImage: string
  }
}

interface SidebarItem {
  href: string
  label: string
  icon: LucideIcon
  external?: boolean
  isLogout?: boolean
}

export default function MobileMenu({
  userType,
  user,
  isLeadership = false,
  isFeedbackLeader = false,
}: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()

  // Only render interactive elements after hydration to prevent mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  const menuItems: Record<"user" | "admin" | "instructor" | "leadership", SidebarItem[]> = {
    user: [
      { href: "/pd", icon: Home, label: "My PD" },
      { href: "/learner/courses", icon: BookOpen, label: "Training Courses" },
      { href: "/learner/profile", icon: User, label: "Profile" },
    ],
    admin: [
      { href: "/pd", icon: Home, label: "My PD" },
      { href: "/learner/courses", icon: BookOpen, label: "Training Courses" },
      { href: "/admin/courses", icon: BookOpen, label: "Training admin" },
      { href: "/admin/profile", icon: User, label: "Profile" },
    ],
    instructor: [
      { href: "/admin/dashboard", icon: Home, label: "Home" },
      { href: "/admin/courses", icon: BookOpen, label: "Courses" },
      { href: "/learner/profile", icon: User, label: "Profile" },
    ],
    leadership: [
      { href: "/pd", icon: Home, label: "My PD" },
      { href: "/learner/courses", icon: BookOpen, label: "Training Courses" },
      { href: "/pd/admin/reports", icon: BarChart, label: "Reports" },
      { href: "/learner/profile", icon: User, label: "Profile" },
    ],
  }

  // Build admin/instructor sidebar items
  const adminSidebarItems: SidebarItem[] = [
    { href: "/admin/learners", label: "Learners", icon: Users },
    { href: "https://t.me/enyosam", label: "Support", icon: HelpCircle, external: true },
  ]

  // Add settings only for admin (not instructor)
  if (userType === "admin") {
    adminSidebarItems.push({ href: "/admin/settings", label: "Training Settings", icon: Settings })
  }

  adminSidebarItems.push({ href: "#", label: "Log Out", icon: LogOut, isLogout: true })

  const sidebarItems: Record<"user" | "admin" | "instructor" | "leadership", SidebarItem[]> = {
    user: [
      { href: "/pd", label: "My PD", icon: Home },
      { href: "/pd/goals", label: "My Goals", icon: BarChart },
      { href: "/pd/observations", label: "Observations", icon: MessageSquare },
      { href: "/pd/cpd", label: "CPD Log", icon: Clock },
      { href: "/learner/courses", label: "Training Courses", icon: BookOpen },
      ...(isFeedbackLeader ? [{ href: "/pd/team", label: "My Team", icon: Users }] : []),
      { href: "#", label: "Log Out", icon: LogOut, isLogout: true },
    ],
    admin: [
      { href: "/pd", label: "My PD", icon: Home },
      { href: "/pd/goals", label: "My Goals", icon: BarChart },
      { href: "/pd/observations", label: "Observations", icon: MessageSquare },
      { href: "/pd/cpd", label: "CPD Log", icon: Clock },
      { href: "/learner/courses", label: "Training Courses", icon: BookOpen },
      { href: "/pd/team", label: "My Team", icon: Users },
      { href: "/pd/admin/staff", label: "Staff", icon: Users },
      { href: "/pd/admin/leaders", label: "Feedback Leaders", icon: Users },
      { href: "/pd/admin/school-goals", label: "School Goals", icon: BarChart },
      { href: "/pd/admin/forms", label: "Observation Forms", icon: MessageSquare },
      { href: "/pd/admin/cpd", label: "Bulk CPD", icon: Clock },
      { href: "/pd/admin/reports", label: "Reports", icon: BarChart },
      { href: "/pd/admin/settings", label: "Years & Settings", icon: Settings },
      { href: "/admin/courses", label: "Training admin", icon: BookOpen },
      { href: "#", label: "Log Out", icon: LogOut, isLogout: true },
    ],
    instructor: [...(isFeedbackLeader ? [{ href: "/pd/team", label: "My Team", icon: Users }] : []), ...adminSidebarItems],
    leadership: [
      { href: "/pd", label: "My PD", icon: Home },
      { href: "/pd/goals", label: "My Goals", icon: BarChart },
      { href: "/pd/observations", label: "Observations", icon: MessageSquare },
      { href: "/pd/cpd", label: "CPD Log", icon: Clock },
      { href: "/learner/courses", label: "Training Courses", icon: BookOpen },
      ...(isFeedbackLeader ? [{ href: "/pd/team", label: "My Team", icon: Users }] : []),
      { href: "/pd/admin/reports", label: "Reports", icon: BarChart },
      { href: "#", label: "Log Out", icon: LogOut, isLogout: true },
    ],
  }

  const currentMenu = menuItems[userType] || menuItems.admin
  const currentSidebar = sidebarItems[userType] || sidebarItems.admin
  const isLoading = !user

  // Don't render Sheet until after hydration to avoid ID mismatch
  if (!mounted) {
    return (
      <header className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-md h-16 px-4 flex items-center justify-between md:px-6 border-b border-border">
        <Button variant="ghost" size="icon" className="lg:hidden bg-transparent">
          {!user ? (
            <Skeleton className="w-10 h-10 rounded-full" />
          ) : (
            <Avatar className="w-10 h-10 overflow-hidden">
              <AvatarImage src={user.profileImage} alt={user.name} className="object-cover" />
              <AvatarFallback>{(user.name || "U").charAt(0)}</AvatarFallback>
            </Avatar>
          )}
        </Button>
        <Logo className="max-w-[220px]" />
        <div className="w-10" />
      </header>
    )
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-md h-16 px-4 flex items-center justify-between md:px-6 border-b border-border">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden bg-transparent">
              {isLoading ? (
                <Skeleton className="w-10 h-10 rounded-full" />
              ) : (
              <Avatar className="w-10 h-10 overflow-hidden">
                <AvatarImage src={user.profileImage} alt={user.name} className="object-cover" />
                  <AvatarFallback>{(user.name || "U").charAt(0)}</AvatarFallback>
              </Avatar>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[250px] sm:w-[300px] p-0 z-[60]">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation Menu</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  {isLoading ? (
                    <>
                      <Skeleton className="w-12 h-12 rounded-full" />
                      <Skeleton className="h-5 w-32" />
                    </>
                  ) : (
                    <>
                  <Avatar className="w-12 h-12 overflow-hidden">
                    <AvatarImage src={user.profileImage} alt={user.name} className="object-cover" />
                        <AvatarFallback>{(user.name || "U").charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                        <p className="font-semibold text-lg">{user.name || "User"}</p>
                  </div>
                    </>
                  )}
                </div>
              </div>
              <nav className="flex-grow px-4 py-6">
                {currentSidebar.map((item) => {
                  if (item.isLogout) {
                    return (
                      <button
                        key={item.href}
                        onClick={() => {
                          setIsOpen(false)
                          logout(userType)
                        }}
                        className="flex items-center py-3 px-4 rounded-lg text-base font-medium w-full text-left text-muted-foreground hover:text-foreground hover:bg-accent"
                      >
                        {item.icon && <item.icon className="w-5 h-5 mr-3" />}
                        {item.label}
                      </button>
                    )
                  }
                  return item.external ? (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center py-3 px-4 rounded-lg text-base font-medium ${
                        pathname === item.href
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                      onClick={() => setIsOpen(false)}
                    >
                      {item.icon && (
                        <item.icon className={`w-5 h-5 mr-3 ${pathname === item.href ? "text-primary" : ""}`} />
                      )}
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={true}
                      className={`flex items-center py-3 px-4 rounded-lg text-base font-medium ${
                        pathname === item.href
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                      onClick={() => setIsOpen(false)}
                    >
                      {item.icon && (
                        <item.icon className={`w-5 h-5 mr-3 ${pathname === item.href ? "text-primary" : ""}`} />
                      )}
                      {item.label}
                    </Link>
                  )
                })}
              </nav>
              <div className="mt-auto p-4">
                <ThemeToggle disableTooltip />
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex-1 flex justify-end">
          <Logo className="w-10 h-10" variant="icon" />
        </div>
      </header>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border h-16 px-4 flex items-center justify-around lg:hidden shadow-lg">
        {currentMenu.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            prefetch={true}
            className={`flex items-center justify-center w-16 h-16 ${
              pathname === item.href ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <item.icon className={`w-6 h-6 ${pathname === item.href ? "text-primary" : ""}`} />
          </Link>
        ))}
      </nav>
    </>
  )
}
