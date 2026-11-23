"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { SourceLesson } from "@/lib/course-import/adapters/types"
import { formatVideoTime } from "@/lib/course-import/workflow"
import { useClientAuthState } from "@/utils/client-auth"

interface Suggestions {
  course: { id: number; title: string; is_published: boolean; lessons: { title: string }[] }
  chapters: SourceLesson[]
  fingerprint: string
}

export default function YouTubeChaptersPage() {
  const { user, userType, loading } = useClientAuthState()
  const params = useParams()
  const router = useRouter()
  const endpoint = `/api/admin/courses/${params.id}/youtube-chapters`
  const [data, setData] = useState<Suggestions | null>(null)
  const [error, setError] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    if (!loading && (!user || userType !== "admin")) router.replace("/auth/admin/login")
  }, [loading, user, userType, router])

  useEffect(() => {
    if (loading || !user || userType !== "admin") return
    let active = true
    fetch(endpoint).then(async (response) => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to load chapter suggestions.")
      if (active) setData(result)
    }).catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : "Unable to load chapter suggestions.")
    })
    return () => { active = false }
  }, [endpoint, loading, user, userType])

  async function replace() {
    if (!data || !confirmed) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: data.fingerprint, confirmed: true }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to replace the lesson.")
      setComplete(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to replace the lesson.")
    } finally { setBusy(false) }
  }

  if (loading || !user || userType !== "admin") return null
  return (
    <main className="p-4 md:p-8 max-w-4xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold">Review video chapters</h1>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!data && !error && <p role="status">Reading video description…</p>}
      {data && (complete ? (
        <div className="space-y-3">
          <p role="status">The original lesson was replaced with {data.chapters.length} video lessons.</p>
          <p>Review the lessons, quizzes, course preview and certificate before using the course.</p>
          <Button asChild><Link href={`/admin/courses/new?edit=${data.course.id}`}>Open course in editor</Link></Button>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{data.course.title}</h2>
          <p>These suggestions come from the video description. The first lesson starts at the beginning of the video. No transcript is imported; add lesson content, levels and quizzes manually.</p>
          <ol className="list-decimal pl-6 space-y-1">
            {data.chapters.map((chapter) => chapter.youtube && (
              <li key={chapter.youtube.startSeconds}>{chapter.title} · {formatVideoTime(chapter.youtube.startSeconds)}–{formatVideoTime(chapter.youtube.endSeconds)} · {chapter.durationMinutes} min</li>
            ))}
          </ol>
          <p>Replacing “{data.course.lessons[0].title}” deletes its existing content, quizzes and resource links. Courses with learner enrolments or activity cannot be replaced this way. {data.course.is_published && "This course is published; the replacement will be visible immediately."}</p>
          <p>Close other editor tabs for this course before replacing it, so stale edits cannot overwrite the new lessons. The existing course preview may be out of date after replacement.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />
            <span>I understand the existing lesson and its contents will be replaced.</span>
          </label>
          <Button disabled={!confirmed || busy} onClick={() => void replace()}>{busy ? "Replacing lesson…" : "Replace lesson with video chapters"}</Button>
        </div>
      ))}
    </main>
  )
}
