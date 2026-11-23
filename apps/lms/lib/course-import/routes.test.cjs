const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const { NextResponse } = require("next/server")

function load(file, mocks) {
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function("require", "module", "exports", code)((id) => id in mocks ? mocks[id] : require(id), loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const root = path.join(__dirname, "..", "..")
const mainFile = path.join(root, "app", "api", "admin", "course-imports", "route.ts")
const stepFile = path.join(root, "app", "api", "admin", "course-imports", "[id]", "route.ts")
const log = { logError() {} }
const context = { params: Promise.resolve({ id: "job" }) }
const post = (body) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) })

test("admin guard rejects anonymous users, learners and missing profiles", async () => {
  for (const profile of [null, { user_type: "user" }, { user_type: "instructor" }]) {
    let serviceCalls = 0
    let user = null
    const server = load(path.join(__dirname, "server.ts"), {
      "server-only": {}, "next/server": { NextResponse },
      "@/lib/supabase/server": {
        createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
        createServiceRoleClient: () => {
          serviceCalls++
          return { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: profile, error: null }) }) }
        },
      },
    })
    assert.equal((await server.requireImportAdmin()).response.status, 403)
    assert.equal(serviceCalls, 0)
    user = { id: "user" }
    assert.equal((await server.requireImportAdmin()).response.status, 403)
    assert.equal(serviceCalls, 1)
  }
})

test("all import routes reject non-admin callers before accessing import data", async () => {
  const forbidden = async () => ({ response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) })
  const main = load(mainFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/fetch": {}, "@/lib/course-import/server": { requireImportAdmin: forbidden },
  })
  const step = load(stepFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": { requireImportAdmin: forbidden },
    "@/lib/course-import/adapters": {}, "@/lib/course-import/fetch": {}, "@/lib/course-import/generation": {},
    "@/lib/course-import/thumbnail": {}, "@/lib/course-import/workflow": {},
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
  })
  assert.equal((await main.GET()).status, 403)
  assert.equal((await main.POST(post({}))).status, 403)
  assert.equal((await step.GET(new Request("http://localhost"), context)).status, 403)
  assert.equal((await step.POST(post({ action: "read" }), context)).status, 403)
  const chaptersFile = path.join(root, "app", "api", "admin", "courses", "[id]", "youtube-chapters", "route.ts")
  const chapters = load(chaptersFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": { requireImportAdmin: forbidden },
    "@/lib/course-import/adapters/html": {}, "@/lib/course-import/adapters/youtube": {},
    "@/lib/course-import/workflow": {},
  })
  assert.equal((await chapters.GET(new Request("http://localhost"), context)).status, 403)
  assert.equal((await chapters.POST(post({}), context)).status, 403)
})

test("chapter suggestions must be approved before lessons are processed and can be declined", async () => {
  const workflow = load(path.join(__dirname, "workflow.ts"), {})
  const one = { title: "Video", url: "https://youtube.com/watch?v=abcdefghijk", durationMinutes: 10 }
  const chapters = [{ ...one, title: "First" }, { ...one, title: "Second" }]
  let job = {
    id: "job", admin_id: "admin", source_url: one.url, status: "lessons", step_log: [], version: 1, course_id: null,
    state: { titleOverride: "", certificateType: "completion", source: {
      title: "Video", owner: "Owner", siteUrl: "https://youtube.com", lessons: [one], chapterSuggestions: chapters,
    }, lessons: [null] },
  }
  const step = load(stepFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": {
      requireImportAdmin: async () => ({ db: {}, user: { id: "admin" } }), getImportJob: async () => job,
      saveImportJob: async (_db, previous, state, status, message, level) => {
        job = { ...previous, state, status, step_log: [...previous.step_log, { message, level }] }
        return job
      },
    },
    "@/lib/course-import/adapters": {}, "@/lib/course-import/fetch": {}, "@/lib/course-import/generation": {},
    "@/lib/course-import/thumbnail": {}, "@/lib/course-import/workflow": workflow,
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
  })
  assert.equal((await step.POST(post({ action: "lesson", index: 0 }), context)).status, 400)
  assert.equal((await step.POST(post({ action: "choose-chapters", choice: "chapters" }), context)).status, 200)
  assert.deepEqual(job.state.source.lessons, chapters)
  assert.deepEqual(job.state.lessons, [null, null])
  assert.equal((await step.POST(post({ action: "choose-chapters", choice: "single" }), context)).status, 400)
  job.state = { ...job.state, chapterChoice: undefined, source: { ...job.state.source, lessons: [one] }, lessons: [null] }
  assert.equal((await step.POST(post({ action: "choose-chapters", choice: "single" }), context)).status, 200)
  assert.deepEqual(job.state.source.lessons, [one])
})

test("replacing a YouTube lesson requires confirmation and unchanged suggestions", async () => {
  const workflow = load(path.join(__dirname, "workflow.ts"), {})
  const chaptersFile = path.join(root, "app", "api", "admin", "courses", "[id]", "youtube-chapters", "route.ts")
  const url = "https://www.youtube.com/watch?v=abcdefghijk"
  const course = { id: 1, title: "Video", source_url: url, updated_at: "2026-01-01", is_published: false,
    lessons: [{ id: 2, title: "Old", updated_at: "2026-01-01" }] }
  const chapters = [
    { title: "First", url, durationMinutes: 2, youtube: { videoId: "abcdefghijk", startSeconds: 0, endSeconds: 120 } },
    { title: "Second", url, durationMinutes: 3, youtube: { videoId: "abcdefghijk", startSeconds: 120, endSeconds: 300 } },
  ]
  let replacement
  const db = {
    from() { return { select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: course, error: null }) } },
    rpc: async (_name, args) => { replacement = args; return { error: null } },
  }
  const route = load(chaptersFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": { requireImportAdmin: async () => ({ db, user: { id: "admin" } }) },
    "@/lib/course-import/adapters/html": { youtubeId: () => "abcdefghijk" },
    "@/lib/course-import/adapters/youtube": { readYouTubeCourse: async () => ({
      title: "Video", owner: "Owner", siteUrl: "https://youtube.com", lessons: [], chapterSuggestions: chapters,
    }) },
    "@/lib/course-import/workflow": workflow,
  })
  const courseContext = { params: Promise.resolve({ id: "1" }) }
  const suggestion = await (await route.GET(new Request("http://localhost"), courseContext)).json()
  assert.equal((await route.POST(post({ fingerprint: suggestion.fingerprint }), courseContext)).status, 400)
  course.updated_at = "2026-01-02"
  assert.equal((await route.POST(post({ fingerprint: suggestion.fingerprint, confirmed: true }), courseContext)).status, 409)
  assert.equal(replacement, undefined)
  const refreshed = await (await route.GET(new Request("http://localhost"), courseContext)).json()
  assert.equal((await route.POST(post({ fingerprint: refreshed.fingerprint, confirmed: true }), courseContext)).status, 200)
  assert.equal(replacement.p_lesson_id, 2)
  assert.equal(replacement.p_lessons.length, 2)
  assert.match(replacement.p_lessons[1].html, /start=120&amp;end=300/)
})

test("starting imports requires rights confirmation and explicit duplicate approval", async () => {
  let starts = 0
  const db = {
    from() { return { select() { return this }, eq() { return this }, async limit() { return { data: [{ id: 1, title: "Existing" }], error: null } } } },
    rpc() { starts++; return { single: async () => ({ data: { id: "job" }, error: null }) } },
  }
  const main = load(mainFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/fetch": { validateImportUrl: (url) => new URL(url) },
    "@/lib/course-import/server": { requireImportAdmin: async () => ({ db, user: { id: "admin" } }) },
  })
  const input = { url: "https://example.com/course", permissionConfirmed: true }
  assert.equal((await main.POST(post({ ...input, permissionConfirmed: false }))).status, 400)
  assert.equal((await main.POST(post(input))).status, 409)
  assert.equal(starts, 0)
  assert.equal((await main.POST(post({ ...input, allowDuplicate: true }))).status, 201)
  assert.equal(starts, 1)
})

test("source-only quiz retains progress without generating a quiz or video", async () => {
  const workflow = load(path.join(__dirname, "workflow.ts"), {})
  let generated = 0
  let job = {
    id: "job", admin_id: "admin", source_url: "https://learnfree.org/series/test", status: "lessons",
    step_log: [], version: 1, course_id: null,
    state: { titleOverride: "", certificateType: "completion",
      source: { title: "Course", owner: "Owner", siteUrl: "https://learnfree.org", lessons: [{ title: "Source quiz", url: "https://learnfree.org/episode/test?id=1", durationMinutes: 8 }] },
      lessons: [null] },
  }
  const step = load(stepFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": {
      requireImportAdmin: async () => ({ db: {}, user: { id: "admin" } }),
      getImportJob: async () => job,
      saveImportJob: async (_db, previous, state, status, message, level) => {
        job = { ...previous, state, status, step_log: [...previous.step_log, { message, level }] }
        return job
      },
    },
    "@/lib/course-import/adapters": { readLesson: async () => ({ text: "", videoIds: [], sourceQuiz: true }) },
    "@/lib/course-import/fetch": {},
    "@/lib/course-import/generation": { generateLesson: async () => { generated++; throw new Error("Unexpected") } },
    "@/lib/course-import/thumbnail": {}, "@/lib/course-import/workflow": workflow,
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
  })
  const response = await step.POST(post({ action: "lesson", index: 0 }), context)
  assert.equal(response.status, 200)
  assert.equal(generated, 0)
  assert.deepEqual(job.state.lessons[0].questions, [])
  assert.doesNotMatch(job.state.lessons[0].html, /iframe/)
  assert.match(job.step_log[0].message, /Source-only quiz/)
})

test("timestamped video lessons do not invent quizzes from chapter titles", async () => {
  const workflow = load(path.join(__dirname, "workflow.ts"), {})
  const url = "https://www.youtube.com/watch?v=abcdefghijk"
  const chapter = { title: "Module", url, durationMinutes: 5, youtube: { videoId: "abcdefghijk", startSeconds: 30, endSeconds: 330 } }
  let job = {
    id: "job", admin_id: "admin", source_url: url, status: "lessons", step_log: [], version: 1, course_id: null,
    state: { titleOverride: "", certificateType: "completion", chapterChoice: "chapters",
      source: { title: "Video", owner: "Owner", siteUrl: "https://youtube.com", lessons: [chapter] }, lessons: [null] },
  }
  const step = load(stepFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": {
      requireImportAdmin: async () => ({ db: {}, user: { id: "admin" } }), getImportJob: async () => job,
      saveImportJob: async (_db, previous, state, status, message, level) => {
        job = { ...previous, state, status, step_log: [...previous.step_log, { message, level }] }
        return job
      },
    },
    "@/lib/course-import/adapters": { readLesson: async () => ({ text: "", videoIds: ["abcdefghijk"], sourceTimestamp: true }) },
    "@/lib/course-import/fetch": {},
    "@/lib/course-import/generation": { generateLesson: async () => { throw new Error("Unexpected quiz generation") } },
    "@/lib/course-import/thumbnail": {}, "@/lib/course-import/workflow": workflow,
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
  })
  assert.equal((await step.POST(post({ action: "lesson", index: 0 }), context)).status, 200)
  assert.deepEqual(job.state.lessons[0].questions, [])
  assert.equal(job.state.lessons[0].durationMinutes, 5)
  assert.match(job.state.lessons[0].html, /start=30&amp;end=330/)
  assert.match(job.step_log[0].message, /No transcript/)
})

test("lesson timeouts identify the phase and preserve progress for retry", async () => {
  const workflow = load(path.join(__dirname, "workflow.ts"), {})
  let fail = true
  let job = {
    id: "job", admin_id: "admin", source_url: "https://learnfree.org/series/test", status: "lessons",
    step_log: [], version: 1, course_id: null,
    state: { titleOverride: "", certificateType: "completion",
      source: { title: "Course", owner: "Owner", siteUrl: "https://learnfree.org", lessons: [{ title: "Source quiz", url: "https://learnfree.org/episode/test?id=1", durationMinutes: 8 }] },
      lessons: [null] },
  }
  const step = load(stepFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": {
      requireImportAdmin: async () => ({ db: {}, user: { id: "admin" } }),
      getImportJob: async () => job,
      saveImportJob: async (_db, previous, state, status, message, level) => {
        job = { ...previous, state, status, step_log: [...previous.step_log, { message, level }] }
        return job
      },
    },
    "@/lib/course-import/adapters": { readLesson: async () => {
      if (fail) throw new DOMException("The operation was aborted due to timeout", "TimeoutError")
      return { text: "", videoIds: [], sourceQuiz: true }
    } },
    "@/lib/course-import/fetch": {}, "@/lib/course-import/generation": {},
    "@/lib/course-import/thumbnail": {}, "@/lib/course-import/workflow": workflow,
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
  })
  const originalTimeout = AbortSignal.timeout
  let deadline
  AbortSignal.timeout = (milliseconds) => {
    deadline = milliseconds
    return originalTimeout(milliseconds)
  }
  try {
    const response = await step.POST(post({ action: "lesson", index: 0 }), context)
    assert.equal(deadline, 50000)
    assert.equal(response.status, 500)
    assert.match((await response.json()).error, /Reading lesson 1 timed out.*resume/i)
    assert.equal(job.state.lessons[0], null)
    assert.match(job.step_log[0].message, /Reading lesson 1 timed out/)
    fail = false
    assert.equal((await step.POST(post({ action: "lesson", index: 0 }), context)).status, 200)
    assert.equal(job.state.lessons[0].title, "Source quiz")
  } finally {
    AbortSignal.timeout = originalTimeout
  }
})

test("a lesson generation lasting longer than eight seconds can complete", async () => {
  const workflow = load(path.join(__dirname, "workflow.ts"), {})
  let job = {
    id: "job", admin_id: "admin", source_url: "https://example.com/course", status: "lessons",
    step_log: [], version: 1, course_id: null,
    state: { titleOverride: "", certificateType: "completion",
      source: { title: "Course", owner: "Owner", siteUrl: "https://example.com", lessons: [{ title: "Lesson", url: "https://example.com/lesson", durationMinutes: 10 }] },
      lessons: [null] },
  }
  const step = load(stepFile, {
    "next/server": { NextResponse }, "@/lib/utils/errorHandler": log,
    "@/lib/course-import/server": {
      requireImportAdmin: async () => ({ db: {}, user: { id: "admin" } }),
      getImportJob: async () => job,
      saveImportJob: async (_db, previous, state, status, message, level) => {
        job = { ...previous, state, status, step_log: [...previous.step_log, { message, level }] }
        return job
      },
    },
    "@/lib/course-import/adapters": { readLesson: async () => ({ text: "Source material", videoIds: [] }) },
    "@/lib/course-import/fetch": {},
    "@/lib/course-import/generation": { generateLesson: async (_title, _source, signal) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 8200)
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
      })
      return { overview: "First sentence. Second sentence.", keyPoints: ["A", "B", "C"], levels: ["beginner"], questions: [] }
    } },
    "@/lib/course-import/thumbnail": {}, "@/lib/course-import/workflow": workflow,
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
  })
  const response = await step.POST(post({ action: "lesson", index: 0 }), context)
  assert.equal(response.status, 200)
  assert.equal(job.state.lessons[0].title, "Lesson")
})
