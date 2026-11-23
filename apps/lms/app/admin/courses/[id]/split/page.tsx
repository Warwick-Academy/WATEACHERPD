"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { useClientAuthState } from "@/utils/client-auth"
import { makePreview } from "@/lib/course-import/preview"
import { sectionTime, suggestSections, type CourseSplit, type SectionPlan, type SplitLesson } from "@/lib/course-import/split"

interface SplitData {
  course: { id: number; title: string; source_url: string | null }
  lessons: SplitLesson[]
  split: CourseSplit | null
  sectionLessons: SplitLesson[][]
}

async function requestJson(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "The split request failed.")
  return data
}

export default function SplitCoursePage() {
  const { user, userType, loading } = useClientAuthState()
  const router = useRouter()
  const params = useParams()
  const endpoint = `/api/admin/courses/${params.id}/split`
  const [data, setData] = useState<SplitData | null>(null)
  const [plans, setPlans] = useState<SectionPlan[]>([])
  const [splitId, setSplitId] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!loading && (!user || userType !== "admin")) router.replace("/auth/admin/login")
  }, [loading, user, userType, router])

  useEffect(() => {
    if (loading || !user || userType !== "admin") return
    let active = true
    requestJson(endpoint).then((result: SplitData) => {
      if (!active) return
      setData(result)
      setPlans(suggestSections(result.course.title, result.lessons))
      setSplitId(sessionStorage.getItem(`course-split-${result.course.id}`) || "")
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : "Unable to load course.")
    })
    return () => { active = false }
  }, [endpoint, loading, user, userType])

  async function refresh(): Promise<SplitData> {
    const result: SplitData = await requestJson(endpoint)
    setData(result)
    return result
  }

  async function finishMedia(initial: CourseSplit, sectionLessons: SplitLesson[][], sourceUrl: string | null) {
    let current = initial
    for (let index = 0; index < current.sections.length; index++) {
      let section = current.sections[index]
      if (!section.thumbnailUrl) {
        setStatus(`Making thumbnail for section ${index + 1} of ${current.sections.length}…`)
        const result = await requestJson(endpoint, { action: "thumbnail", splitId: current.id, index })
        current = result.split
        section = current.sections[index]
        setData((previous) => previous ? { ...previous, split: current } : previous)
      }
      if (section.previewUrl) continue
      const lessons = sectionLessons[index]
      if (!lessons?.length) throw new Error(`Section ${index + 1} has no saved lessons. Refresh and retry.`)
      setStatus(`Making preview for section ${index + 1}. Keep this page open…`)
      const blob = await makePreview(
        section.title, lessons, section.minutes, section.pdHours,
        sourceUrl ? `Source: ${sourceUrl}. See the lessons for content credits.` : "See the lessons for content credits.",
        (slide, total) => setStatus(`Section ${index + 1}: recording slide ${slide} of ${total}. Keep this page open…`),
        section.level,
      )
      setStatus(`Uploading preview for section ${index + 1}…`)
      const signed = await requestJson(endpoint, {
        action: "preview-sign", splitId: current.id, index, contentType: blob.type, fileSize: blob.size,
      })
      current = signed.split
      setData((previous) => previous ? { ...previous, split: current } : previous)
      const upload = await fetch(signed.signedUrl, {
        method: "PUT", headers: { "Content-Type": blob.type, "x-upsert": "true" }, body: blob,
      })
      if (!upload.ok) throw new Error(`Preview upload failed (HTTP ${upload.status}).`)
      const saved = await requestJson(endpoint, { action: "preview-save", splitId: current.id, index, url: signed.previewUrl })
      current = saved.split
      setData((previous) => previous ? { ...previous, split: current } : previous)
    }
    setStatus("All section drafts and previews are ready for review.")
  }

  async function create() {
    if (!data) return
    setBusy(true)
    setError("")
    const id = splitId || crypto.randomUUID()
    setSplitId(id)
    sessionStorage.setItem(`course-split-${data.course.id}`, id)
    try {
      setStatus("Creating section drafts…")
      await requestJson(endpoint, { action: "create", splitId: id, sections: plans })
      const latest = await refresh()
      if (!latest.split || latest.split.id !== id) throw new Error("Unable to reload the new split. Refresh and retry.")
      await finishMedia(latest.split, latest.sectionLessons, latest.course.source_url)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to create sections.")
      setStatus("")
      try { await refresh() } catch (refreshError) {
        setError((message) => `${message} Unable to refresh progress: ${refreshError instanceof Error ? refreshError.message : "unknown error"}`)
      }
    } finally { setBusy(false) }
  }

  async function resume() {
    if (!data?.split) return
    setBusy(true)
    setError("")
    try { await finishMedia(data.split, data.sectionLessons, data.course.source_url) }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to finish section media."); setStatus("") }
    finally { setBusy(false) }
  }

  if (loading || !user || userType !== "admin") return null
  const updatePlan = (index: number, patch: Partial<SectionPlan>) => setPlans((previous) =>
    previous.map((plan, i) => i === index ? { ...plan, ...patch } : plan))
  const moveLesson = (lessonId: number, target: number) => setPlans((previous) => previous.map((plan, index) => ({
    ...plan,
    lessonIds: data?.lessons.filter((lesson) =>
      (lesson.id === lessonId ? index === target : plan.lessonIds.includes(lesson.id))).map((lesson) => lesson.id) || [],
  })))
  const ready = plans.length >= 2 && plans.every((plan) => plan.title.trim() && plan.lessonIds.length > 0)
  return (
    <main className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Split course into sections</h1>
      <p className="text-muted-foreground mb-6">The original course and its learners remain unchanged. Suggested groups follow the original lesson order; adjust their titles, lessons and levels. Each section becomes a separate draft with its own certificate and preview.</p>
      {!data?.split && error && <p role="alert" className="mb-4 text-destructive">{error}</p>}
      {!data?.split && status && <p role="status" className="mb-4">{status}</p>}
      {data && !data.split && (
        <div className="space-y-4">
          {data.lessons.length < 2 && <p>At least two lessons are needed to split a course.</p>}
          {plans.map((plan, index) => {
            const lessons = data.lessons.filter((lesson) => plan.lessonIds.includes(lesson.id))
            const time = sectionTime(lessons)
            return (
              <section key={index} className="rounded-lg border p-4 space-y-3">
                <h2 className="font-semibold">Section {index + 1}</h2>
                <label className="block">Title
                  <input className="mt-1 w-full rounded-md border bg-background p-2" value={plan.title} maxLength={200} disabled={busy}
                    onChange={(event) => updatePlan(index, { title: event.target.value })} />
                </label>
                <label className="block">Level
                  <select className="mt-1 w-full rounded-md border bg-background p-2" value={plan.level} disabled={busy}
                    onChange={(event) => {
                      const level = event.target.value
                      if (level === "beginner" || level === "intermediate" || level === "advanced") updatePlan(index, { level })
                    }}>
                    <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
                  </select>
                </label>
                <p>{lessons.length} lessons · {time.minutes} minutes · {time.pdHours} PD hours</p>
                <ul className="space-y-2">{lessons.map((lesson) => (
                  <li key={lesson.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{lesson.title}</span>
                    <label>Move to <select className="rounded-md border bg-background p-1" value={index} disabled={busy}
                      onChange={(event) => moveLesson(lesson.id, Number(event.target.value))}>
                      {plans.map((_, option) => <option key={option} value={option}>Section {option + 1}</option>)}
                    </select></label>
                  </li>
                ))}</ul>
                {plans.length > 2 && lessons.length === 0 && <Button variant="outline" disabled={busy}
                  onClick={() => setPlans((previous) => previous.filter((_, i) => i !== index))}>Remove empty section</Button>}
              </section>
            )
          })}
          {plans.length > 0 && <Button variant="outline" disabled={busy || plans.length >= data.lessons.length}
            onClick={() => setPlans((previous) => [...previous, { title: `${data.course.title}: New section`, level: "beginner", lessonIds: [] }])}>Add section</Button>}
          <div><Button disabled={busy || !ready} onClick={() => void create()}>Create draft sections</Button></div>
          {!ready && plans.length > 0 && <p>Give every section a title and at least one lesson.</p>}
        </div>
      )}
      {data?.split && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Section drafts</h2>
          {data.split.sections.map((section) => (
            <div key={section.courseId} className="rounded-lg border p-4">
              <h3 className="font-semibold">{section.title}</h3>
              <p>{section.level} · {section.lessonIds.length} lessons · {section.minutes} minutes · {section.pdHours} PD hours</p>
              <p>Thumbnail: {section.thumbnailUrl ? "ready" : "pending"} · Preview: {section.previewUrl ? "ready" : "pending"}</p>
              <Link className="underline" href={`/admin/courses/new?edit=${section.courseId}`}>Open draft in editor</Link>
            </div>
          ))}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {status && <p role="status">{status}</p>}
          {!busy && data.split.sections.some((section) => !section.thumbnailUrl || !section.previewUrl) &&
            <Button onClick={() => void resume()}>Resume making section previews</Button>}
        </section>
      )}
    </main>
  )
}
