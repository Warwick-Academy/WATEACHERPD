import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")

  if (!code) {
    return NextResponse.redirect(new URL("/auth/learner/login?error=microsoft", requestUrl.origin))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL("/auth/learner/login?error=microsoft", requestUrl.origin))
  }

  const email = data.user?.email?.toLowerCase() ?? ""
  if (!email.endsWith("@warwick.bm")) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL("/auth/learner/login?error=domain", requestUrl.origin))
  }

  return NextResponse.redirect(new URL("/pd", requestUrl.origin))
}
