"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import Indicator from "@/components/Indicator"
import Logo from "@/components/Logo"
import { createClient } from "@/lib/supabase/client"

export default function StaffLoginPage() {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams.get("error") === "domain") {
      setError("Use a Warwick Academy Microsoft account ending in @warwick.bm.")
    } else if (searchParams.get("error") === "microsoft") {
      setError("Microsoft sign-in was unsuccessful. Please try again.")
    }
  }, [searchParams])

  const signInWithMicrosoft = async () => {
    setError("")
    setLoading(true)
    const supabase = createClient()
    const origin = window.location.origin
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email",
        redirectTo: `${origin}/auth/callback`,
      },
    })
    if (oauthError) {
      setLoading(false)
      setError("Microsoft sign-in could not be started. Please try again.")
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-6 sm:px-6 sm:py-8">
      <div className="w-full max-w-md space-y-4 sm:space-y-6">
        <div className="text-center">
          <Logo className="mx-auto mb-4 w-full max-w-[260px] sm:max-w-[340px]" />
        </div>
        <Card className="w-full">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-xl sm:text-2xl">Warwick Academy Professional Development</CardTitle>
            <CardDescription className="text-sm sm:text-base">
              Sign in with your Warwick Academy Microsoft account.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {error && (
              <Alert variant="destructive" className="text-sm">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex flex-col space-y-3 p-4 pt-0 sm:p-6 sm:pt-0">
            <Button type="button" className="min-h-[44px] w-full text-sm sm:text-base" onClick={signInWithMicrosoft} disabled={loading}>
              {loading ? "Connecting..." : "Sign in with Microsoft"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Use an account ending in @warwick.bm</p>
          </CardFooter>
        </Card>
        <Indicator />
      </div>
    </div>
  )
}
