import { NextResponse } from "next/server"
import { z } from "zod"
import { logError } from "@/lib/utils/errorHandler"
import { validateImportUrl } from "@/lib/course-import/fetch"
import { requireImportAdmin } from "@/lib/course-import/server"

const startSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().max(200).default(""),
  certificateType: z.enum(["completion", "participation", "achievement"]).default("completion"),
  permissionConfirmed: z.literal(true),
  allowDuplicate: z.boolean().default(false),
})

export async function GET() {
  try {
    const auth = await requireImportAdmin()
    if (auth.response) return auth.response
    const { data, error } = await auth.db.from("course_imports").select("*")
      .eq("admin_id", auth.user.id).order("created_at", { ascending: false }).limit(10)
    if (error) throw new Error(`Failed to load imports: ${error.message}`)
    return NextResponse.json({ imports: data })
  } catch (error) {
    logError("Failed to load course imports", error, { component: "admin/course-imports" })
    return NextResponse.json({ error: "Unable to load imports." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireImportAdmin()
    if (auth.response) return auth.response
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
    }
    const parsed = startSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "Check the URL, settings and permission confirmation." }, { status: 400 })
    let url: string
    try {
      url = validateImportUrl(parsed.data.url).href
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid URL." }, { status: 400 })
    }
    const { data: matches, error: matchError } = await auth.db.from("courses").select("id, title")
      .eq("source_url", url).limit(5)
    if (matchError) throw new Error(`Duplicate check failed: ${matchError.message}`)
    if (matches.length && !parsed.data.allowDuplicate) {
      return NextResponse.json({ error: "A course from this URL already exists.", matches }, { status: 409 })
    }
    const { data: job, error } = await auth.db.rpc("start_course_import", {
      p_admin_id: auth.user.id, p_source_url: url, p_title: parsed.data.title,
      p_certificate_type: parsed.data.certificateType,
    }).single()
    if (error) {
      if (error.message.includes("Import limit reached")) return NextResponse.json({ error: error.message }, { status: 429 })
      throw new Error(`Failed to start import: ${error.message}`)
    }
    return NextResponse.json({ import: job }, { status: 201 })
  } catch (error) {
    logError("Failed to start course import", error, { component: "admin/course-imports" })
    return NextResponse.json({ error: "Unable to start import. Check the URL and try again." }, { status: 500 })
  }
}
