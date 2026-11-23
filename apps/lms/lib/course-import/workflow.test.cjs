const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

function load(file, mocks = {}, jsx = false) {
  const code = typescript.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020, jsx: jsx ? typescript.JsxEmit.ReactJSX : undefined },
  }).outputText
  const loadedModule = { exports: {} }
  new Function("require", "module", "exports", code)((id) => id in mocks ? mocks[id] : require(id), loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const workflow = load("workflow.ts")

test("PD hours include only generated quizzes and round up to quarter hours", () => {
  const lesson = (durationMinutes, hasQuiz) => ({ durationMinutes, questions: hasQuiz ? [{}] : [] })
  assert.deepEqual(workflow.calculateTime([lesson(34, true), lesson(0, true), lesson(0, true), lesson(0, true)]), { minutes: 46, pdHours: 1 })
  assert.deepEqual(workflow.calculateTime([lesson(42, true)]), { minutes: 45, pdHours: 0.75 })
  assert.deepEqual(workflow.calculateTime([lesson(31, false)]), { minutes: 31, pdHours: 0.75 })
})

test("lesson HTML escapes generated text and uses editor-compatible video embeds", () => {
  const course = { owner: "Owner & Co", siteUrl: "https://example.com" }
  const html = workflow.lessonHtml(course, "https://example.com/a?x=1&y=2", '<script>alert("x")</script>',
    ["A < B"], ["abcdefghijk", "lmnopqrstuv"])
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /<div data-youtube-video><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk" allowfullscreen><\/iframe><\/div>/)
  assert.match(html, /Optional extra video/)
  assert.match(html, /x=1&amp;y=2/)
  const unknownOwner = workflow.lessonHtml({ ...course, owner: "" }, "https://example.com/a", "Overview.", [], [])
  assert.match(unknownOwner, /Content owner not identified/)
  assert.doesNotMatch(unknownOwner, /owner and copyright holder/)
  const chapter = workflow.lessonHtml(course, "https://example.com/a", "Overview.", [], ["abcdefghijk"],
    { videoId: "abcdefghijk", startSeconds: 65, endSeconds: 433 })
  assert.match(chapter, /embed\/abcdefghijk\?start=65&amp;end=433/)
  assert.match(chapter, /Video creator: Owner &amp; Co/)
  assert.doesNotMatch(chapter, /owner and copyright holder/)
})

test("generated thumbnail is a 1280 by 720 PNG", async () => {
  const style = load("style.ts")
  const { makeThumbnail } = load("thumbnail.tsx", { "./style": style }, true)
  const sharp = require("sharp")
  const buffer = await makeThumbnail("Spreadsheet foundations", [{ title: "Worksheets", levels: ["beginner"] }], 46, 1)
  const metadata = await sharp(buffer).metadata()
  assert.equal(metadata.format, "png")
  assert.equal(metadata.width, 1280)
  assert.equal(metadata.height, 720)
})

test("preview recording starts on the first animation frame even if its timestamp precedes setup", async () => {
  const { makePreview } = load("preview.ts", {
    "./style": { courseStyle: () => ({ topic: "COURSE", accent: "#000" }), mainLevel: () => "beginner" },
  })
  const previous = {
    document: globalThis.document, MediaRecorder: globalThis.MediaRecorder,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  let stopped = false
  let frames = 0
  const context = {
    createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fillText() {}, measureText: () => ({ width: 10 }), roundRect() {},
  }
  globalThis.document = { createElement: () => ({
    getContext: () => context, captureStream: () => ({ getTracks: () => [{ stop: () => { stopped = true } }] }),
  }) }
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true }
    state = "inactive"
    start() { this.state = "recording" }
    stop() { this.state = "inactive"; queueMicrotask(() => this.onstop()) }
  }
  globalThis.requestAnimationFrame = (callback) => {
    const time = performance.now() + (frames++ === 0 ? -100 : 60000)
    queueMicrotask(() => callback(time))
    return frames
  }
  globalThis.cancelAnimationFrame = () => {}
  const progress = []
  try {
    await makePreview("Course", [{ title: "Lesson", overview: "Overview.", durationMinutes: 5, levels: [], questions: [] }],
      5, 0.25, "Credit", (slide) => progress.push(slide))
    assert.deepEqual(progress, [1])
    assert.equal(stopped, true)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
})

test("invalid quiz is regenerated once and omitted if still invalid", async () => {
  const actualQuiz = load(path.join("..", "ai", "quiz-generation.ts"), {})
  const question = { type: "multiple-choice", text: "Question", options: ["a", "a", "c", "d"], correctOption: 0, explanation: "Explanation." }
  let calls = 0
  const generation = load("generation.ts", {
    "server-only": {},
    "@ai-sdk/anthropic": { createAnthropic: () => () => ({}) },
    "ai": { generateObject: async () => {
      calls++
      return { object: calls === 1
        ? { overview: "First sentence. Second sentence.", keyPoints: ["A", "B", "C"], levels: ["beginner"], questions: [question, question, question, question, question] }
        : { questions: [question, question, question, question, question] } }
    } },
    "@/lib/ai/quiz-generation": actualQuiz,
  })
  const oldKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = "test-key"
  try {
    const result = await generation.generateLesson("Lesson", "Source", AbortSignal.timeout(10000))
    assert.equal(calls, 2)
    assert.deepEqual(result.questions, [])
    assert.match(result.warning, /no quiz/)
  } finally {
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = oldKey
  }
})

  test("malformed quiz fields trigger regeneration without discarding the lesson", async () => {
    const actualQuiz = load(path.join("..", "ai", "quiz-generation.ts"), {})
    const questions = [
      { type: "multiple-choice", text: "First?", options: ["a", "b", "c", "d"], correctOption: 1, explanation: "Because it is correct." },
      ...[1, 2, 3, 4].map((n) => ({ type: "true-false", text: `Question ${n}?`, correctAnswer: true, explanation: "This is correct." })),
    ]
    let calls = 0
    const generation = load("generation.ts", {
      "server-only": {},
      "@ai-sdk/anthropic": { createAnthropic: () => () => ({}) },
      "ai": { generateObject: async () => {
        calls++
        return { object: calls === 1
          ? { overview: "First sentence. Second sentence.", keyPoints: ["A", "B", "C"], levels: ["beginner"], questions: [{ type: "multiple-choice" }] }
          : { questions } }
      } },
      "@/lib/ai/quiz-generation": actualQuiz,
    })
    const oldKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    try {
      const result = await generation.generateLesson("Lesson", "Source", AbortSignal.timeout(10000))
      assert.equal(calls, 2)
      assert.equal(result.questions.length, 5)
      assert.equal(result.warning, undefined)
    } finally {
      if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = oldKey
    }
  })

  test("structured output failures retry lesson generation once", async () => {
    const actualQuiz = load(path.join("..", "ai", "quiz-generation.ts"), {})
    let calls = 0
    const parseError = new Error("Invalid structured output")
    const generation = load("generation.ts", {
      "server-only": {},
      "@ai-sdk/anthropic": { createAnthropic: () => () => ({}) },
      "ai": {
        NoObjectGeneratedError: { isInstance: (error) => error === parseError },
        generateObject: async () => {
          calls++
          if (calls === 1) throw parseError
          return { object: { overview: "First sentence. Second sentence.", keyPoints: ["A", "B", "C"], levels: ["beginner"], questions: [] } }
        },
      },
      "@/lib/ai/quiz-generation": actualQuiz,
    })
    const oldKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"
    try {
      const result = await generation.generateLesson("Lesson", "Source", AbortSignal.timeout(10000))
      assert.equal(calls, 3)
      assert.equal(result.questions.length, 0)
      assert.match(result.warning, /no quiz/)
    } finally {
      if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = oldKey
    }
  })
