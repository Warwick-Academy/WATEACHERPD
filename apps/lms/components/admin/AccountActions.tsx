"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { toast } from "sonner"

export default function AccountActions({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState<{ email: string | null; emailConfirmed: boolean } | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const changeOpen = async (next: boolean) => {
    if (busy) return
    setOpen(next)
    setPassword("")
    setError("")
    setAccount(null)
    if (!next) return
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/account`, { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load account")
      setAccount(data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load account")
    } finally {
      setBusy(false)
    }
  }

  const submit = async (action: "reset-password" | "resend-confirmation" | "confirm-email") => {
    if (action === "reset-password" && password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reset-password" ? { action, password } : { action }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Account action failed")
      setPassword("")
      if (action === "confirm-email") setAccount((current) => current ? { ...current, emailConfirmed: true } : current)
      toast.success(action === "reset-password" ? "Password reset. Share it securely with the user." : action === "confirm-email" ? "Email confirmed. The user can sign in with their password." : "Confirmation email requested. Check the inbox and spam folder.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Account action failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <Button variant="outline" size="sm" onClick={() => changeOpen(true)}>Account actions<span className="sr-only"> for {name}</span></Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account actions for {name}</DialogTitle>
          <DialogDescription>Manage the password or email confirmation.</DialogDescription>
        </DialogHeader>
        {busy && !account && <p>Loading account...</p>}
        {account && (
          <div className="space-y-4">
            <p className="text-sm">Auth email: {account.email || "Not available"} ({account.emailConfirmed ? "confirmed" : "not confirmed"})</p>
            {!account.emailConfirmed && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">The email must be confirmed before the user can sign in. Resetting the password does not confirm it.</p>
                <Button variant="outline" disabled={busy || !account.email} onClick={() => submit("resend-confirmation")}>
                  Resend signup confirmation
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={busy || !account.email}>Confirm email manually</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirm this email?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Only proceed if you have independently verified that {name} controls {account.email}. This lets them sign in without using the email confirmation link.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => submit("confirm-email")}>Confirm email</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={`account-password-${userId}`}>New password</Label>
              <Input id={`account-password-${userId}`} type="password" autoComplete="new-password" value={password}
                onChange={(event) => setPassword(event.target.value)} disabled={busy} minLength={8} />
              <p className="text-sm text-muted-foreground">At least 8 characters. Share the password securely; no email is sent.</p>
              <Button disabled={busy} onClick={() => submit("reset-password")}>Reset password</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
