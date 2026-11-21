"use client"

import type React from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Logo from "@/components/Logo"
import Indicator from "@/components/Indicator"

export default function ConfirmEmailPage() {
  const [tokenHash, setTokenHash] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token_hash")
    if (token) {
      setTokenHash(token)
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  const confirmEmail = async () => {
    setError("")
    setLoading(true)
    try {
      const response = await fetch("/api/auth/confirm-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || "Could not confirm your email.")
        return
      }
      router.replace("/learner/dashboard")
    } catch {
      setError("Could not confirm your email. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const resendEmail = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    setSent(false)
    setLoading(true)
    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || "Could not send a confirmation email.")
        return
      }
      setTokenHash("")
      setSent(true)
    } catch {
      setError("Could not send a confirmation email. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-background px-4 sm:px-6 py-6 sm:py-8">
      <div className="w-full max-w-md space-y-4 sm:space-y-6">
        <div className="text-center">
          <Logo className="mx-auto mb-4 sm:mb-8 w-full max-w-[260px] sm:max-w-[340px]" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Confirm your email</CardTitle>
            <CardDescription>
              {tokenHash
                ? "Click the button below to finish confirming your email address."
                : "Enter your email address to request a new confirmation email."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {sent && (
              <Alert role="status">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  If the account needs confirmation, check your inbox and spam folder for a new email.
                </AlertDescription>
              </Alert>
            )}
            {tokenHash && (
              <Button type="button" className="w-full" disabled={loading} onClick={confirmEmail}>
                {loading ? "Confirming..." : "Confirm email address"}
              </Button>
            )}
            {(!tokenHash || error) && (
              <form onSubmit={resendEmail} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  If your email is already confirmed, try logging in instead.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending..." : "Send confirmation email"}
                </Button>
              </form>
            )}
          </CardContent>
          <CardFooter className="justify-center text-sm">
            <Link href="/auth/learner/login" className="underline">Back to login</Link>
          </CardFooter>
        </Card>
        <Indicator />
      </div>
    </div>
  )
}
