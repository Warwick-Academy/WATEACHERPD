import { ImageResponse } from "next/og"
import type { LessonLevel } from "@/lib/lesson-levels"
import { courseStyle, mainLevel } from "./style"

export async function makeThumbnail(title: string, lessons: readonly { title: string; levels: LessonLevel[] }[], minutes: number, pdHours: number, level?: LessonLevel) {
  const topics = lessons.slice(0, 3).map((lesson) => lesson.title).join(" · ")
  const displayLevel = level || mainLevel(lessons)
  const { topic, accent } = courseStyle(title)
  const image = new ImageResponse(
    <div style={{
      display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%",
      padding: "72px 86px", color: "white", background: `linear-gradient(125deg, ${accent}, #17406E 70%, #091a31)`,
    }}>
      {Array.from({ length: 19 }, (_, index) => (
        <div key={`v${index}`} style={{ position: "absolute", left: index * 64, top: 0, width: 1, height: 720, backgroundColor: "rgba(170,207,233,0.07)" }} />
      ))}
      {Array.from({ length: 11 }, (_, index) => (
        <div key={`h${index}`} style={{ position: "absolute", left: 0, top: index * 64, width: 1280, height: 1, backgroundColor: "rgba(170,207,233,0.07)" }} />
      ))}
      <div style={{ display: "flex", color: "#AACFE9", fontSize: 30, letterSpacing: 4, fontWeight: 700 }}>TEACHER PD · {topic}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: title.length > 80 ? 48 : 70, lineHeight: 1.08, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 28, color: "#AACFE9" }}>{topics}</div>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {[`${lessons.length} lessons`, `~${minutes} min`, `${pdHours} PD hours`, displayLevel].map((badge) => (
          <div key={badge} style={{ display: "flex", borderRadius: 40, border: "2px solid #AACFE9", padding: "12px 20px", fontSize: 24 }}>{badge}</div>
        ))}
      </div>
    </div>,
    { width: 1280, height: 720 },
  )
  return Buffer.from(await image.arrayBuffer())
}
