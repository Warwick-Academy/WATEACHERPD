const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const { generateObject } = require("ai")
const { MockLanguageModelV4 } = require("ai/test")
const { createAnthropic } = require("@ai-sdk/anthropic")

function loadTypeScript(file, mocks = {}) {
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", code)(
    (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports
  )
  return module.exports
}

const quiz = loadTypeScript(path.join(__dirname, "quiz-generation.ts"))
const exampleQuestions = [
  { type: "multiple-choice", text: "Which action?", options: ["Correct", "Wrong 1", "Wrong 2", "Wrong 3"], correctOption: 0, explanation: "This action is correct." },
  { type: "true-false", text: "Is this true?", correctAnswer: true, explanation: "This is true." },
]

function modelReturning(questions) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ questions }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } },
      warnings: [],
    }),
  })
}

function routeFor({ role = "admin", signedIn = true, model = modelReturning(exampleQuestions), profileError = null } = {}) {
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: "user-1" } : null } }) },
    from: () => ({
      select() { return this },
      eq() { return this },
      single: async () => ({ data: { user_type: role }, error: profileError }),
    }),
  }
  return loadTypeScript(path.join(__dirname, "..", "..", "app", "api", "ai", "generate-quiz", "route.ts"), {
    "ai": { generateObject },
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/utils/errorHandler": { logError() {} },
    "@/lib/ai/quiz-model": { getQuizModel: () => model },
    "@/lib/ai/quiz-generation": quiz,
  }).POST
}

const validRequest = {
  lessonTitle: "Example lesson",
  lessonContent: `<p>${"Teaching practice. ".repeat(20)}</p><iframe src="https://example.test">ignore this</iframe>`,
  extraText: "",
  questionCount: 2,
  questionTypes: ["multiple-choice", "true-false"],
  difficulty: "medium",
}
const request = (body) => ({ json: async () => body })

test("extracts readable text but excludes embedded video and scripts", () => {
  assert.equal(quiz.lessonTextFromHtml("<p>First &amp; second</p><iframe><p>hidden</p></iframe><script>hidden</script><p>Last</p>"), "First & second Last")
})

test("shuffle preserves the correct answer and creates unique editor-compatible IDs", () => {
  const questions = quiz.formatGeneratedQuestions([...exampleQuestions, ...exampleQuestions])
  assert.equal(new Set(questions.map((question) => question.id)).size, questions.length)
  assert.ok(questions.every((question) => /^q-\d+-[a-f0-9]+$/.test(question.id) && question.points === 1))
  for (const question of questions.filter((item) => item.type === "multiple-choice")) {
    assert.equal(question.options.length, 4)
    assert.equal(question.options[question.correctOption], "Correct")
  }
})

test("rejects unauthenticated and non-admin callers before generating", async () => {
  assert.equal((await routeFor({ signedIn: false })(request(validRequest))).status, 403)
  assert.equal((await routeFor({ role: "user" })(request(validRequest))).status, 403)
  assert.equal((await routeFor({ profileError: new Error("database error") })(request(validRequest))).status, 500)
})

test("reports missing configuration and rejects invalid or insufficient source", async () => {
  assert.equal((await routeFor({ model: null })(request(validRequest))).body.error, "AI quiz generation is not configured")
  const post = routeFor()
  assert.equal((await post(request({ ...validRequest, questionCount: 21 }))).status, 400)
  assert.equal((await post(request({ ...validRequest, questionTypes: [] }))).status, 400)
  assert.equal((await post(request({ ...validRequest, lessonContent: "<iframe>hidden</iframe>", extraText: "" }))).status, 400)
  assert.equal((await post(request({ ...validRequest, lessonContent: "x".repeat(30001) }))).status, 400)
})

test("uses AI SDK structured generation and returns reviewable questions", async () => {
  const model = modelReturning(exampleQuestions)
  const response = await routeFor({ model })(request(validRequest))
  assert.equal(response.status, 200)
  assert.equal(response.body.questions.length, 2)
  assert.equal(response.body.questions[0].options[response.body.questions[0].correctOption], "Correct")
  assert.equal(response.body.questions[1].correctAnswer, true)
  assert.equal(model.doGenerateCalls.length, 1)
  const serializedCall = JSON.stringify(model.doGenerateCalls[0])
  assert.ok(serializedCall.includes("Teaching practice"))
  assert.ok(!serializedCall.includes("ignore this"))
  assert.ok(model.doGenerateCalls[0].responseFormat.schema)
})

test("Anthropic adapter accepts the structured schema without a network call", async () => {
  let sent
  const provider = createAnthropic({
    apiKey: "test-key",
    fetch: async (_url, init) => {
      sent = JSON.parse(init.body)
      return Response.json({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [{ type: "tool_use", id: "toolu_test", name: "json", input: { questions: exampleQuestions } }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      })
    },
  })
  const result = await generateObject({
    model: provider("test-model"),
    schema: quiz.generatedQuizSchema,
    prompt: "Test with synthetic data",
    maxOutputTokens: 8000,
  })
  assert.equal(result.object.questions.length, 2)
  assert.ok(sent.tools?.[0]?.input_schema)
})

test("rejects mismatched types, counts and failed AI calls", async () => {
  assert.equal((await routeFor()(request({ ...validRequest, questionTypes: ["true-false"] }))).status, 500)
  assert.equal((await routeFor()(request({ ...validRequest, questionCount: 1 }))).status, 500)
  const failingModel = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("provider failed") } })
  const response = await routeFor({ model: failingModel })(request(validRequest))
  assert.equal(response.status, 500)
  assert.equal(response.body.error, "Unable to generate quiz questions. Please try again.")
})
