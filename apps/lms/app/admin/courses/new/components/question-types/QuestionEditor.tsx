"use client"

import { Question, QuestionType } from "../../types/quiz"
import MultipleChoiceQuestion from "./MultipleChoiceQuestion"
import TrueFalseQuestion from "./TrueFalseQuestion"
import FillInBlankQuestion from "./FillInBlankQuestion"
import ShortAnswerQuestion from "./ShortAnswerQuestion"
import EssayQuestion from "./EssayQuestion"
import MatchingQuestion from "./MatchingQuestion"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useId } from "react"

interface QuestionEditorProps {
  question: Question
  onChange: (question: Question) => void
  onDelete?: () => void
  courseId?: string | number
  lessonId?: string | number
}

function QuestionExplanation({ question, onChange }: Pick<QuestionEditorProps, "question" | "onChange">) {
  const id = useId()
  return (
    <div className="space-y-2 mt-4">
      <Label htmlFor={id}>Answer explanation (optional)</Label>
      <Textarea id={id} value={question.explanation || ""} onChange={(event) => onChange({ ...question, explanation: event.target.value })} />
    </div>
  )
}

export default function QuestionEditor({ question, onChange, onDelete, courseId, lessonId }: QuestionEditorProps) {
  const handleChange = (updatedQuestion: Question) => {
    onChange(updatedQuestion)
  }

  switch (question.type) {
    case "multiple-choice":
      return (
        <>
          <MultipleChoiceQuestion
            question={question}
            onChange={handleChange}
            onDelete={onDelete}
            courseId={courseId}
            lessonId={lessonId}
          />
          <QuestionExplanation question={question} onChange={handleChange} />
        </>
      )
    case "true-false":
      return (
        <>
          <TrueFalseQuestion
            question={question}
            onChange={handleChange}
            onDelete={onDelete}
            courseId={courseId}
            lessonId={lessonId}
          />
          <QuestionExplanation question={question} onChange={handleChange} />
        </>
      )
    case "fill-blank":
      return (
        <FillInBlankQuestion
          question={question}
          onChange={handleChange}
          onDelete={onDelete}
        />
      )
    case "short-answer":
      return (
        <ShortAnswerQuestion
          question={question}
          onChange={handleChange}
          onDelete={onDelete}
        />
      )
    case "essay":
      return (
        <EssayQuestion
          question={question}
          onChange={handleChange}
          onDelete={onDelete}
        />
      )
    case "matching":
      return (
        <MatchingQuestion
          question={question}
          onChange={handleChange}
          onDelete={onDelete}
        />
      )
    default:
      return null
  }
}

export function createQuestion(type: QuestionType, id?: string): Question {
  const baseQuestion = {
    id: id || `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    text: "",
    points: 1,
  }

  switch (type) {
    case "multiple-choice":
      return {
        ...baseQuestion,
        type: "multiple-choice",
        options: ["", ""],
        correctOption: 0,
      } as Question
    case "true-false":
      return {
        ...baseQuestion,
        type: "true-false",
        correctAnswer: true,
      } as Question
    case "fill-blank":
      return {
        ...baseQuestion,
        type: "fill-blank",
        correctAnswers: [""],
        caseSensitive: false,
      } as Question
    case "short-answer":
      return {
        ...baseQuestion,
        type: "short-answer",
        correctKeywords: [""],
        caseSensitive: false,
      } as Question
    case "essay":
      return {
        ...baseQuestion,
        type: "essay",
      } as Question
    case "matching":
      return {
        ...baseQuestion,
        type: "matching",
        leftItems: [""],
        rightItems: [""],
        correctMatches: [],
      } as Question
    default:
      throw new Error(`Unknown question type: ${type}`)
  }
}

