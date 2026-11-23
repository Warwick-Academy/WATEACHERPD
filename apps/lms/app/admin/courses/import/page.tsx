"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useClientAuthState } from "@/utils/client-auth"
import { createCourseSlug } from "@/lib/slug"
import { makePreview } from "@/lib/course-import/preview"
import { calculateTime, formatVideoTime, type CertificateType, type ImportedLesson, type ImportJob } from "@/lib/course-import/workflow"

class ImportError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function requestJson(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new ImportError(data.error || "The import request failed.", response.status)
  return data
}

export default function ImportCoursePage() {
  const { user, userType, loading } = useClientAuthState()
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [certificateType, setCertificateType] = useState<CertificateType>("completion")
  const [permission, setPermission] = useState(false)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [currentStep, setCurrentStep] = useState("")
  const [error, setError] = useState("")
  const userId = user?.id

  useEffect(() => {
    if (!loading && (!user || userType !== "admin")) router.replace("/auth/admin/login")
  }, [loading, user, userType, router])

  useEffect(() => {
    if (loading || !userId || userType !== "admin") return
    let active = true
    requestJson("/api/admin/course-imports").then((result) => {
      if (active && result.imports?.length) setJob(result.imports[0])
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : "Unable to load previous imports.")
    })
    return () => { active = false }
  }, [loading, userId, userType])

  const step = async (id: string, body: unknown): Promise<ImportJob> => {
    const result = await requestJson(`/api/admin/course-imports/${id}`, body)
    setJob(result.import)
    return result.import
  }

  const runImport = async (initial: ImportJob) => {
    let current = initial
    try {
      if (!current.state.source) {
        setCurrentStep("Reading course page…")
        current = await step(current.id, { action: "read" })
      }
      if (current.state.source?.chapterSuggestions && !current.state.chapterChoice) {
        setCurrentStep("")
        return
      }
      const total = current.state.source?.lessons.length || 0
      for (let index = 0; index < total; index++) {
        if (current.state.lessons?.[index]) continue
        setCurrentStep(`Lesson ${index + 1} of ${total}: ${current.state.source?.lessons[index].title} — writing overview and quiz…`)
        current = await step(current.id, { action: "lesson", index })
      }
      if (!current.state.details) {
        setCurrentStep("Writing course description…")
        current = await step(current.id, { action: "describe" })
      }
      if (!current.course_id) {
        setCurrentStep("Creating course…")
        current = await step(current.id, { action: "create" })
      }
      if (!current.state.thumbnailUrl) {
        setCurrentStep("Making thumbnail…")
        current = await step(current.id, { action: "thumbnail" })
      }
      const lessons = (current.state.lessons || []).filter((lesson): lesson is ImportedLesson => lesson !== null)
      const { minutes, pdHours } = calculateTime(lessons)
      let previewUrl: string | undefined
      let previewWarning: string | undefined
      try {
        setCurrentStep("Making preview video. Keep this page open…")
        const blob = await makePreview(
          current.state.titleOverride || current.state.source?.title || "Course",
          lessons, minutes, pdHours, current.state.source?.owner
            ? current.state.source.lessons[0]?.youtube
              ? `Video creator: ${current.state.source.owner}. Verify copyright and permissions. Visit ${current.state.source.siteUrl}.`
              : `Video and tutorial content © ${current.state.source.owner}, the owner and copyright holder. Used for non-public educational purposes. Visit ${current.state.source.siteUrl}.`
            : `Content owner not identified; verify copyright and permissions. Visit ${current.state.source?.siteUrl || "the source website"}.`,
          (index, count) => setCurrentStep(`Making preview video: slide ${index} of ${count}. Keep this page open…`),
        )
        setCurrentStep("Uploading preview video…")
        const signed = await requestJson(`/api/admin/course-imports/${current.id}`, {
          action: "preview-sign", contentType: blob.type, fileSize: blob.size,
        })
        current = signed.import
        setJob(current)
        const upload = await fetch(signed.signedUrl, {
          method: "PUT", headers: { "Content-Type": blob.type, "x-upsert": "true" }, body: blob,
        })
        if (!upload.ok) throw new Error(`Preview upload failed (HTTP ${upload.status}).`)
        previewUrl = signed.previewUrl
      } catch (failure) {
        previewWarning = failure instanceof Error ? failure.message : "Preview generation failed."
      }
      setCurrentStep("Publishing…")
      current = await step(current.id, { action: "publish", previewUrl, previewWarning })
      setJob(current)
      setCurrentStep("")
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import failed.")
      setCurrentStep("")
      try {
        const latest = await requestJson(`/api/admin/course-imports/${current.id}`)
        setJob(latest.import)
      } catch (refreshError) {
        setError(`${failure instanceof Error ? failure.message : "Import failed."} Unable to refresh progress: ${refreshError instanceof Error ? refreshError.message : "unknown error"}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    setBusy(true)
    setError("")
    try {
      const input = { url, title, certificateType, permissionConfirmed: permission, allowDuplicate: false }
      let result
      try {
        result = await requestJson("/api/admin/course-imports", input)
      } catch (failure) {
        if (!(failure instanceof ImportError) || failure.status !== 409) throw failure
        if (!window.confirm("A course from this URL already exists. Create another copy?")) {
          setBusy(false)
          return
        }
        result = await requestJson("/api/admin/course-imports", { ...input, allowDuplicate: true })
      }
      setJob(result.import)
      await runImport(result.import)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to start import.")
      setBusy(false)
    }
  }

  const chooseChapters = async (choice: "chapters" | "single") => {
    if (!job) return
    setBusy(true)
    setError("")
    try {
      const current = await step(job.id, { action: "choose-chapters", choice })
      await runImport(current)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to select lessons.")
      setBusy(false)
    }
  }

  if (loading || !user || userType !== "admin") return null
  const completedLessons = job?.state.lessons?.filter((lesson): lesson is ImportedLesson => lesson !== null) || []
  return (
    <main className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Create course from URL</h1>
      <p className="text-muted-foreground mb-6">Only import content you have permission to retrieve and use. Keep this page open while the preview is recorded.</p>
      <div className="space-y-4">
        <label className="block">Course page URL
          <input className="mt-1 w-full rounded-md border bg-background p-2" type="url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} />
        </label>
        <label className="block">Course title (optional)
          <input className="mt-1 w-full rounded-md border bg-background p-2" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
        </label>
        <label className="block">Certificate type
          <select className="mt-1 w-full rounded-md border bg-background p-2" value={certificateType} onChange={(event) => {
            const value = event.target.value
            if (value === "completion" || value === "participation" || value === "achievement") setCertificateType(value)
          }} disabled={busy}>
            <option value="completion">Completion</option><option value="participation">Participation</option><option value="achievement">Achievement</option>
          </select>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} disabled={busy} />
          <span>I&apos;ve checked that this content&apos;s terms allow us to use it</span>
        </label>
        <Button onClick={start} disabled={busy || !permission || !url.trim()}>Create course</Button>
      </div>
      {error && <p role="alert" className="mt-4 text-destructive">{error}</p>}
      {currentStep && <p role="status" className="mt-4">{currentStep}</p>}
      {job && (
        <section className="mt-8 border rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">Import progress</h2>
          <ul className="space-y-2">
            {job.step_log.map((entry, index) => <li key={index} className={entry.level === "error" ? "text-destructive" : ""}>{entry.message}</li>)}
          </ul>
          {job.state.source?.chapterSuggestions && !job.state.chapterChoice && (
            <div className="mt-4 space-y-3">
              <h3 className="font-semibold">Suggested video lessons</h3>
              <p>Review these suggestions. The first lesson starts at the beginning of the video. No transcript is imported, so add lesson content, levels and quizzes manually.</p>
              <ol className="list-decimal pl-6">
                {job.state.source.chapterSuggestions.map((lesson) => (
                  <li key={lesson.youtube?.startSeconds}>{lesson.title} · {lesson.youtube && `${formatVideoTime(lesson.youtube.startSeconds)}–${formatVideoTime(lesson.youtube.endSeconds)} · `}{lesson.durationMinutes} min</li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void chooseChapters("chapters")}>Use suggested lessons</Button>
                <Button disabled={busy} variant="outline" onClick={() => void chooseChapters("single")}>Use one full-video lesson</Button>
              </div>
            </div>
          )}
          {job.status !== "completed" && !busy && !(job.state.source?.chapterSuggestions && !job.state.chapterChoice) && (
            <Button className="mt-4" variant="outline" onClick={() => { setError(""); setBusy(true); void runImport(job) }}>Resume import</Button>
          )}
          {job.status === "completed" && job.course_id && (
            <div className="mt-4 space-y-3">
              <p>{completedLessons.length} lessons · {calculateTime(completedLessons).pdHours} PD hours</p>
              <div className="flex flex-wrap gap-3">
                <Button asChild><Link href={`/admin/courses/new?edit=${job.course_id}`}>Open in editor</Link></Button>
                <Button asChild variant="outline"><Link href={`/learner/courses/${createCourseSlug(job.state.titleOverride || job.state.source?.title || "course", job.course_id)}`}>View as learner</Link></Button>
                <Button asChild variant="outline"><Link href={`/admin/courses/${job.course_id}/split`}>Split into sections</Link></Button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
