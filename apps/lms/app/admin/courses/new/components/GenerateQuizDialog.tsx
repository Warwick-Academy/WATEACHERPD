"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { MultipleChoiceQuestion, TrueFalseQuestion } from "../types/quiz"

type GeneratedQuestion = MultipleChoiceQuestion | TrueFalseQuestion
type GeneratedType = GeneratedQuestion["type"]

interface GenerateQuizDialogProps {
  lessonTitle: string
  lessonContent: string
  onAdd: (questions: GeneratedQuestion[], replace: boolean) => void
}

export default function GenerateQuizDialog({ lessonTitle, lessonContent, onAdd }: GenerateQuizDialogProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [extraText, setExtraText] = useState("")
  const [questionCount, setQuestionCount] = useState("5")
  const [questionTypes, setQuestionTypes] = useState<GeneratedType[]>(["multiple-choice", "true-false"])
  const [difficulty, setDifficulty] = useState("medium")
  const [mode, setMode] = useState("add")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  const changeOpen = (next: boolean) => {
    if (!next) {
      request.current?.abort()
      request.current = null
      setLoading(false)
      setError("")
      setQuestions([])
      setSelected(new Set())
    }
    setOpen(next)
  }

  const toggleType = (type: GeneratedType, checked: boolean) => {
    setQuestionTypes((current) => checked ? [...current, type] : current.filter((item) => item !== type))
  }

  const generate = async () => {
    const count = Number(questionCount)
    if (!Number.isInteger(count) || count < 1 || count > 20 || questionTypes.length === 0) {
      setError("Choose at least one question type and a whole number of questions from 1 to 20.")
      return
    }
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError("")
    setQuestions([])
    setSelected(new Set())
    try {
      const response = await fetch("/api/ai/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonTitle, lessonContent, extraText, questionCount: count, questionTypes, difficulty }),
        signal: controller.signal,
      })
      const result: { questions?: GeneratedQuestion[], error?: string } = await response.json().catch(() => {
        throw new Error("Unable to generate quiz questions. Please try again.")
      })
      if (!response.ok || !result.questions) throw new Error(result.error || "Unable to generate quiz questions.")
      setQuestions(result.questions)
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error && !(err instanceof TypeError) ? err.message : "Unable to generate quiz questions. Please try again.")
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }

  const addSelected = () => {
    const chosen = questions.filter((question) => selected.has(question.id))
    if (chosen.length === 0) return
    onAdd(chosen, mode === "replace")
    changeOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">Generate quiz with AI</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate quiz with AI</DialogTitle>
          <DialogDescription>
            Questions use this lesson&apos;s title and content plus any notes below. Videos cannot be watched.
            Review the results before adding them. Nothing is saved to the database until you save the course.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-title`}>Lesson title (read-only)</Label>
            <Input id={`${id}-title`} value={lessonTitle} readOnly className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-content`}>Lesson text or HTML (read-only)</Label>
            <Textarea id={`${id}-content`} value={lessonContent} readOnly rows={3} placeholder="No lesson text" className="bg-muted" />
            <p className="text-xs text-muted-foreground">To change the lesson title or content, edit the lesson outside this dialog.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-extra`}>Video transcript or extra notes (optional)</Label>
            <Textarea id={`${id}-extra`} value={extraText} onChange={(event) => setExtraText(event.target.value)} maxLength={30000} rows={5} disabled={loading} placeholder="Paste or type a transcript or notes here" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-count`}>Number of questions</Label>
              <Input id={`${id}-count`} type="number" min={1} max={20} step={1} value={questionCount} onChange={(event) => setQuestionCount(event.target.value)} disabled={loading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-difficulty`}>Difficulty</Label>
              <Select value={difficulty} onValueChange={setDifficulty} disabled={loading}>
                <SelectTrigger id={`${id}-difficulty`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="space-y-2" disabled={loading}>
            <legend className="text-sm font-medium">Question types</legend>
            {([["multiple-choice", "Multiple choice"], ["true-false", "True/false"]] as const).map(([type, label]) => (
              <div key={type} className="flex items-center gap-2">
                <Checkbox id={`${id}-${type}`} checked={questionTypes.includes(type)} onCheckedChange={(checked) => toggleType(type, checked === true)} />
                <Label htmlFor={`${id}-${type}`}>{label}</Label>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-2" disabled={loading}>
            <legend className="text-sm font-medium">When adding selected questions</legend>
            <RadioGroup value={mode} onValueChange={setMode} disabled={loading}>
              <div className="flex items-center gap-2"><RadioGroupItem value="add" id={`${id}-add`} /><Label htmlFor={`${id}-add`}>Add to existing questions</Label></div>
              <div className="flex items-center gap-2"><RadioGroupItem value="replace" id={`${id}-replace`} /><Label htmlFor={`${id}-replace`}>Replace existing questions</Label></div>
            </RadioGroup>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {questions.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold">Review generated questions</h3>
              <p className="text-sm text-muted-foreground">Select the questions you want to keep.</p>
              {questions.map((question, index) => (
                <div key={question.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`${id}-${question.id}`}
                      checked={selected.has(question.id)}
                      onCheckedChange={(checked) => setSelected((current) => {
                        const next = new Set(current)
                        if (checked === true) next.add(question.id)
                        else next.delete(question.id)
                        return next
                      })}
                    />
                    <Label htmlFor={`${id}-${question.id}`} className="leading-normal">{index + 1}. {question.text}</Label>
                  </div>
                  {question.type === "multiple-choice" && (
                    <ul className="list-disc pl-8 text-sm">
                      {question.options.map((option, optionIndex) => <li key={optionIndex}>{option}</li>)}
                    </ul>
                  )}
                  <p className="text-sm"><strong>Correct answer:</strong> {question.type === "multiple-choice" ? question.options[question.correctOption] : question.correctAnswer ? "True" : "False"}</p>
                  <p className="text-sm"><strong>Explanation:</strong> {question.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={generate} disabled={loading}>
            {loading ? "Generating..." : questions.length ? "Regenerate" : "Generate"}
          </Button>
          {questions.length > 0 && (
            <Button type="button" onClick={addSelected} disabled={loading || selected.size === 0}>Add selected questions</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
