import "server-only"
import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/lib/supabase/server"
import type { ImportJob, ImportState } from "./workflow"

export async function requireImportAdmin() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  const db = createServiceRoleClient()
  const { data: profile, error } = await db.from("profiles").select("user_type").eq("id", user.id).maybeSingle()
  if (error) throw new Error(`Failed to verify administrator: ${error.message}`)
  if (profile?.user_type !== "admin") return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  return { db, user }
}

export async function getImportJob(
  db: ReturnType<typeof createServiceRoleClient>, adminId: string, id: string,
): Promise<ImportJob> {
  const { data, error } = await db.from("course_imports").select("*").eq("id", id).eq("admin_id", adminId).maybeSingle()
  if (error) throw new Error(`Failed to load import: ${error.message}`)
  if (!data) throw new Error("Import not found.")
  return data as ImportJob
}

export async function saveImportJob(
  db: ReturnType<typeof createServiceRoleClient>, job: ImportJob,
  state: ImportState, status: string, message: string, level: "info" | "warning" | "error" = "info",
) {
  const { data, error } = await db.from("course_imports").update({
    state, status, step_log: [...job.step_log, { message, level }], version: job.version + 1, updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("admin_id", job.admin_id).eq("version", job.version).select("*").maybeSingle()
  if (error) throw new Error(`Failed to save import progress: ${error.message}`)
  if (!data) throw new Error("Import changed in another request. Refresh and retry.")
  return data as ImportJob
}
