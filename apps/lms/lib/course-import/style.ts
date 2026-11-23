import type { LessonLevel } from "@/lib/lesson-levels"

export function courseStyle(title: string) {
  const text = title.toLowerCase()
  if (/\b(excel|spreadsheet|workbook)\b/.test(text)) return { topic: "SPREADSHEETS", accent: "#217346" }
  if (/\b(word|writing|document)\b/.test(text)) return { topic: "DOCUMENTS", accent: "#2862a2" }
  return { topic: "PROFESSIONAL DEVELOPMENT", accent: "#15583f" }
}

export function mainLevel(lessons: readonly { levels: LessonLevel[] }[]): string {
  const counts = new Map<LessonLevel, number>()
  for (const lesson of lessons) {
    for (const level of lesson.levels) counts.set(level, (counts.get(level) || 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "All levels"
}
