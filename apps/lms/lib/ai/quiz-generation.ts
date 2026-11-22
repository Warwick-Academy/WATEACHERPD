import { Parser } from "htmlparser2"
import { z } from "zod"
import type { Question } from "@/app/admin/courses/new/types/quiz"

export const quizRequestSchema = z.object({
  lessonTitle: z.string().trim().max(500),
  lessonContent: z.string().max(100000),
  extraText: z.string().max(30000),
  questionCount: z.number().int().min(1).max(20),
  questionTypes: z.array(z.enum(["multiple-choice", "true-false"])).min(1).max(2)
    .refine((types) => new Set(types).size === types.length),
  difficulty: z.enum(["easy", "medium", "hard"]),
})

const questionText = z.string().trim().min(1).max(2000)

export const generatedQuizSchema = z.object({
  questions: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("multiple-choice"),
      text: questionText,
      options: z.array(questionText).length(4),
      correctOption: z.number().int().min(0).max(3),
      explanation: questionText,
    }),
    z.object({
      type: z.literal("true-false"),
      text: questionText,
      correctAnswer: z.boolean(),
      explanation: questionText,
    }),
  ])).min(1).max(20),
})

export function lessonTextFromHtml(html: string): string {
  const parts: string[] = []
  let ignoredDepth = 0
  const ignoredTags = new Set(["iframe", "script", "style", "noscript"])
  const parser = new Parser({
    onopentag(name) {
      if (ignoredDepth > 0 || ignoredTags.has(name)) ignoredDepth++
      else parts.push(" ")
    },
    ontext(text) {
      if (ignoredDepth === 0) parts.push(text)
    },
    onclosetag() {
      if (ignoredDepth > 0) ignoredDepth--
      else parts.push(" ")
    },
  }, { decodeEntities: true })
  parser.end(html)
  return parts.join("").replace(/\s+/g, " ").trim()
}

export function formatGeneratedQuestions(
  generated: z.infer<typeof generatedQuizSchema>["questions"],
): Question[] {
  return generated.map((question) => {
    const id = `q-${Date.now()}-${crypto.randomUUID().replace(/-/g, "")}`
    if (question.type === "true-false") return { ...question, id, points: 1 }

    const options = question.options.map((text, index) => ({
      text,
      correct: index === question.correctOption,
    }))
    for (let i = options.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
      ;[options[i], options[j]] = [options[j], options[i]]
    }
    return {
      ...question,
      id,
      points: 1,
      options: options.map((option) => option.text),
      correctOption: options.findIndex((option) => option.correct),
    }
  })
}
