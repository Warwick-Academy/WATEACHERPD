export interface SourceLesson {
  title: string
  url: string
  durationMinutes: number | null
  sourceQuiz?: boolean
  sourceId?: string
  youtube?: { videoId: string; startSeconds: number; endSeconds: number }
}

export interface SourceCourse {
  title: string
  description: string
  owner: string
  siteUrl: string
  lessons: SourceLesson[]
  chapterSuggestions?: SourceLesson[]
  chapterWarning?: string
}

export interface LessonMaterial {
  text: string
  videoIds: string[]
}
