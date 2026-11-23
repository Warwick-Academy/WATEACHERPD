import type { LessonLevel } from "@/lib/lesson-levels"
import { courseStyle, mainLevel } from "./style"

interface PreviewLesson {
  title: string
  overview: string
  durationMinutes: number
  levels: LessonLevel[]
  questions: readonly unknown[]
}

interface Slide {
  label: string
  title: string
  subtitle: string
  badges?: string[]
}

export async function makePreview(
  title: string, lessons: PreviewLesson[], minutes: number, pdHours: number, credit: string,
  onProgress: (slide: number, total: number) => void,
  level?: LessonLevel,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") throw new Error("Video recording is not supported by this browser.")
  const contentType = ["video/mp4", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type))
  if (!contentType) throw new Error("This browser cannot record MP4 or WebM video.")
  const canvas = document.createElement("canvas")
  canvas.width = 1280
  canvas.height = 720
  const context = canvas.getContext("2d")
  if (!context || !canvas.captureStream) throw new Error("Canvas recording is not supported by this browser.")
  const slides: Slide[] = [
    { label: `TEACHER PD · ${courseStyle(title).topic}`, title, subtitle: lessons.slice(0, 3).map((lesson) => lesson.title).join(" · "),
      badges: [`${lessons.length} lessons`, `~${minutes} min`, `${pdHours} PD hours`, level || mainLevel(lessons)] },
    ...lessons.map((lesson, index) => ({
      label: `LESSON ${index + 1} OF ${lessons.length}`,
      title: lesson.title,
      subtitle: `${lesson.overview.split(/(?<=[.!?])\s/)[0]} · ${lesson.durationMinutes} min${lesson.questions.length ? " + quiz" : ""}`,
    })),
    { label: "HOW IT WORKS", title: "Watch → Quiz → Certify", subtitle: "Learn at your own pace" },
    { label: "TEACHER PD", title: `${lessons.length} lessons · ${pdHours} PD hours`, subtitle: credit },
  ]
  if (slides.length < 6) {
    slides.splice(1, 0, {
      label: "WHAT YOU WILL LEARN", title: "Build practical skills", subtitle: lessons.map((lesson) => lesson.title).join(" · "),
    })
  }
  if (slides.length < 6) {
    slides.splice(2, 0, {
      label: "GET STARTED", title: "Learn at your own pace", subtitle: "Explore the lesson and its original source.",
    })
  }
  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType: contentType, videoBitsPerSecond: 1_000_000 })
  const chunks: Blob[] = []
  let animationFrame = 0
  const recorded = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => reject(new Error("Preview recording failed."))
    recorder.onstop = () => resolve(new Blob(chunks, { type: contentType }))
  })

  const wrap = (text: string, maxWidth: number, maxLines: number) => {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ""
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (context.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else line = next
    }
    if (line) lines.push(line)
    return lines.slice(0, maxLines)
  }
  const draw = (slide: Slide, alpha = 1) => {
    context.globalAlpha = alpha
    const gradient = context.createLinearGradient(0, 0, 1280, 720)
    gradient.addColorStop(0, courseStyle(title).accent)
    gradient.addColorStop(0.7, "#17406E")
    gradient.addColorStop(1, "#091a31")
    context.fillStyle = gradient
    context.fillRect(0, 0, 1280, 720)
    context.strokeStyle = "rgba(170,207,233,0.07)"
    for (let x = 0; x < 1280; x += 64) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 720); context.stroke() }
    for (let y = 0; y < 720; y += 64) { context.beginPath(); context.moveTo(0, y); context.lineTo(1280, y); context.stroke() }
    context.fillStyle = "#AACFE9"
    context.font = "bold 30px sans-serif"
    context.fillText(slide.label, 86, 100)
    context.fillStyle = "white"
    context.font = "bold 64px sans-serif"
    wrap(slide.title, 1100, 3).forEach((line, index) => context.fillText(line, 86, 260 + index * 75))
    context.font = "28px sans-serif"
    context.fillStyle = "#AACFE9"
    wrap(slide.subtitle, 1100, slide.badges ? 2 : 4).forEach((line, index) => context.fillText(line, 86, 490 + index * 36))
    if (slide.badges) {
      let x = 86
      context.font = "24px sans-serif"
      for (const badge of slide.badges) {
        const width = context.measureText(badge).width + 36
        context.strokeStyle = "#AACFE9"
        context.beginPath()
        if (typeof context.roundRect === "function") context.roundRect(x, 615, width, 48, 24)
        else context.rect(x, 615, width, 48)
        context.stroke()
        context.fillText(badge, x + 18, 646)
        x += width + 14
      }
    }
    context.globalAlpha = 1
  }
  try {
    recorder.start(1000)
    let started: number | undefined
    let lastSlide = -1
    const playback = new Promise<void>((resolve, reject) => {
      const frame = (now: number) => {
        try {
          started ??= now
          const elapsed = now - started
          const index = Math.floor(elapsed / 5500)
          if (index >= slides.length) { resolve(); return }
          if (index !== lastSlide) { lastSlide = index; onProgress(index + 1, slides.length) }
          draw(slides[index])
          const transition = elapsed % 5500
          if (transition >= 5000 && slides[index + 1]) draw(slides[index + 1], (transition - 5000) / 500)
          animationFrame = requestAnimationFrame(frame)
        } catch (error) {
          reject(error)
        }
      }
      animationFrame = requestAnimationFrame(frame)
    })
    await Promise.race([playback, recorded.then(() => { throw new Error("Preview recording stopped unexpectedly.") })])
    recorder.stop()
    return await recorded
  } finally {
    cancelAnimationFrame(animationFrame)
    if (recorder.state !== "inactive") recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
  }
}
