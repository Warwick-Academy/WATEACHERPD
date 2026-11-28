import { createClient } from "@supabase/supabase-js"
import { runScheduledNotifications } from "../../lib/pd/notifications"

export default async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("PD notification job requires Supabase service role configuration.")
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const result = await runScheduledNotifications(client)
  console.info("PD notification job finished:", result)
}

export const config = { schedule: "0 12 * * *" }
