import { Badge } from "@/components/ui/badge"
import { LESSON_LEVELS, type LessonLevel } from "@/lib/lesson-levels"

const styles: Record<LessonLevel, string> = {
  beginner: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  intermediate: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  advanced: "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
}

export default function LessonLevelBadges({ levels }: { levels?: readonly LessonLevel[] | null }) {
  if (!levels?.length) return null
  return (
    <div className="inline-flex flex-wrap gap-1">
      {LESSON_LEVELS.filter((level) => levels.includes(level)).map((level) => (
        <Badge key={level} variant="secondary" className={styles[level]}>
          {level.charAt(0).toUpperCase() + level.slice(1)}
        </Badge>
      ))}
    </div>
  )
}
