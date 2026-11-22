import "server-only"
import { createAnthropic } from "@ai-sdk/anthropic"

export function getQuizModel() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey?.trim()) return null

  const provider = createAnthropic({ apiKey })
  return provider(process.env.AI_QUIZ_MODEL?.trim() || "claude-sonnet-5-5")
}
