import type { SupabaseClient } from "@supabase/supabase-js"

const fileTypes: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

export function evidenceFileInfo(file: Pick<File, "name" | "size" | "type">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  const mimeType = fileTypes[extension]
  if (!mimeType || (file.type && file.type !== mimeType)) throw new Error("Choose a PDF, PNG, JPG or DOCX file.")
  if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error("Evidence must be non-empty and no larger than 10 MB.")
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180)
  return { filename, mimeType }
}

export async function uploadEvidence(supabase: SupabaseClient, userId: string, file: File) {
  const { filename, mimeType } = evidenceFileInfo(file)
  const path = `${userId}/${crypto.randomUUID()}-${filename}`
  const { error } = await supabase.storage.from("pd-evidence").upload(path, file, { contentType: mimeType, upsert: false })
  if (error) throw new Error(error.message)
  return path
}

export async function removeUnusedEvidence(supabase: SupabaseClient, path: string) {
  const references = await supabase.from("pd_cpd_activities").select("id").eq("evidence_path", path).limit(1)
  if (references.error) throw new Error(references.error.message)
  if (references.data.length) return
  const { error } = await supabase.storage.from("pd-evidence").remove([path])
  if (error) throw new Error(error.message)
}
