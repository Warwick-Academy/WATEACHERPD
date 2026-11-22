"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { assignCourses } from "@/lib/admin/assignments"
import CourseSelector from "./CourseSelector"
import { toast } from "sonner"

export default function AddUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"user" | "admin">("user")
  const [passwordMode, setPasswordMode] = useState("generate")
  const [password, setPassword] = useState("")
  const [courses, setCourses] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<{ password?: string; failures: string[] } | null>(null)
  const queryClient = useQueryClient()
  const changeOpen = (next: boolean) => {
    if (busy) return
    if (!next) {
      setName(""); setEmail(""); setRole("user"); setPasswordMode("generate"); setPassword("")
      setCourses([]); setError(""); setResult(null)
    }
    onOpenChange(next)
  }
  const submit = async () => {
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        (passwordMode === "manual" && password.length < 8)) {
      setError("Enter a name, valid email and a password of at least 8 characters.")
      return
    }
    setBusy(true); setError("")
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, userType: role, generatePassword: passwordMode === "generate", ...(passwordMode === "manual" ? { password } : {}) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to create user")
      const assignment = await assignCourses([{ id: data.user.id, name, enrolledCourses: [] }], courses)
      setResult({ password: data.temporaryPassword, failures: assignment.failures })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["learners"] }),
        queryClient.invalidateQueries({ queryKey: ["learner-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["platformUsers"] }),
        queryClient.invalidateQueries({ queryKey: ["teamMembers"] }),
        queryClient.invalidateQueries({ queryKey: ["courses"] }),
      ])
      toast.success("Account created")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create user")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>Create a confirmed account and optionally assign published courses.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <p>Account created for {email}.</p>
            {result.password && <div className="space-y-2">
              <Label htmlFor="temporary-password">Temporary password (shown only once)</Label>
              <div className="flex gap-2"><Input id="temporary-password" readOnly value={result.password} />
                <Button variant="outline" onClick={async () => {
                  try { await navigator.clipboard.writeText(result.password!); toast.success("Password copied") }
                  catch { toast.error("Copy failed; select and copy the password manually.") }
                }}>Copy</Button>
              </div>
              <p className="text-sm text-muted-foreground">Copy it before closing this dialog.</p>
            </div>}
            {result.failures.length > 0 && <div role="alert" className="text-sm text-destructive"><p>The account was created, but some assignments failed:</p><ul>{result.failures.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
            <DialogFooter><Button onClick={() => changeOpen(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="new-user-name">Full name</Label><Input id="new-user-name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="new-user-email">Email</Label><Input id="new-user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></div>
            <div className="space-y-2"><Label htmlFor="new-user-role">Role</Label>
              <Select value={role} onValueChange={(value: "user" | "admin") => setRole(value)} disabled={busy}>
                <SelectTrigger id="new-user-role"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="user">Teacher (learner)</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Password</legend>
              <RadioGroup value={passwordMode} onValueChange={setPasswordMode} disabled={busy}>
                <div className="flex items-center gap-2"><RadioGroupItem value="generate" id="password-generated" /><Label htmlFor="password-generated">Generate a temporary password</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="manual" id="password-manual" /><Label htmlFor="password-manual">Set password myself</Label></div>
              </RadioGroup>
              {passwordMode === "manual" && <Input type="password" aria-label="Password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} placeholder="At least 8 characters" />}
            </fieldset>
            <div className="space-y-2"><Label>Assign courses now (optional)</Label><CourseSelector selected={courses} onChange={setCourses} disabled={busy} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button variant="outline" onClick={() => changeOpen(false)} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? "Creating..." : "Create User"}</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
