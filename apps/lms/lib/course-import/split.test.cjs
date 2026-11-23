const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const { NextResponse } = require("next/server")

function load(file, mocks = {}) {
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function("require", "module", "exports", code)((id) => id in mocks ? mocks[id] : require(id), loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const levels = load(path.join(__dirname, "..", "lesson-levels.ts"))
const { suggestSections, sectionTime } = load(path.join(__dirname, "split.ts"), { "@/lib/lesson-levels": levels })

test("suggestions cover every lesson once in order and provide editable levels", () => {
  const lessons = Array.from({ length: 36 }, (_, index) => ({
    id: index + 1, title: `Lesson ${index + 1}`, overview: "Overview", durationMinutes: 10,
    levels: [index < 18 ? "beginner" : "advanced"], questions: [true],
  }))
  const sections = suggestSections("Course", lessons)
  assert.equal(sections.length, 6)
  assert.deepEqual(sections.flatMap((section) => section.lessonIds), lessons.map((lesson) => lesson.id))
  assert.equal(sections[0].level, "beginner")
  assert.equal(sections[5].level, "advanced")
  assert.deepEqual(sectionTime(lessons.slice(0, 6)), { minutes: 78, pdHours: 1.5 })
  assert.deepEqual(suggestSections("Single", lessons.slice(0, 1)), [])
  assert.equal(suggestSections("Two", lessons.slice(0, 2)).length, 2)
})

test("split API rejects non-admins before accessing course data", async () => {
  const file = path.join(__dirname, "..", "..", "app", "api", "admin", "courses", "[id]", "split", "route.ts")
  const route = load(file, {
    "next/server": { NextResponse },
    "@/lib/course-import/server": { requireImportAdmin: async () => ({ response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }) },
    "@/lib/course-import/adapters/html": {}, "@/lib/course-import/thumbnail": {},
    "@/lib/lesson-levels": levels, "@/lib/course-import/split": {},
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
    "@/lib/utils/errorHandler": { logError() {} },
  })
  const context = { params: Promise.resolve({ id: "1" }) }
  assert.equal((await route.GET(new Request("http://localhost"), context)).status, 403)
  assert.equal((await route.POST(new Request("http://localhost", { method: "POST", body: "{}" }), context)).status, 403)
})

test("split API validates section input before creating drafts", async () => {
  const file = path.join(__dirname, "..", "..", "app", "api", "admin", "courses", "[id]", "split", "route.ts")
  let calls = 0
  const db = { rpc: (_name, args) => {
    calls++
    assert.equal(args.p_course_id, 1)
    assert.equal(args.p_admin_id, "admin")
    return { single: async () => ({ data: { id: args.p_split_id }, error: null }) }
  } }
  const route = load(file, {
    "next/server": { NextResponse },
    "@/lib/course-import/server": { requireImportAdmin: async () => ({ db, user: { id: "admin" } }) },
    "@/lib/course-import/adapters/html": {}, "@/lib/course-import/thumbnail": {},
    "@/lib/lesson-levels": levels, "@/lib/course-import/split": {},
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
    "@/lib/utils/errorHandler": { logError() {} },
  })
  const context = { params: Promise.resolve({ id: "1" }) }
  const body = { action: "create", splitId: "22222222-2222-4222-8222-222222222222",
    sections: [{ title: "First", level: "beginner", lessonIds: [1] }, { title: "Second", level: "advanced", lessonIds: [2] }] }
  const request = (value) => new Request("http://localhost", { method: "POST", body: JSON.stringify(value) })
  assert.equal((await route.POST(request({ ...body, sections: [body.sections[0]] }), context)).status, 400)
  assert.equal(calls, 0)
  assert.equal((await route.POST(request(body), context)).status, 200)
  assert.equal(calls, 1)
})

test("split timing counts questions when quiz settings are absent", async () => {
  const file = path.join(__dirname, "..", "..", "app", "api", "admin", "courses", "[id]", "split", "route.ts")
  const db = { from: (table) => {
    const data = table === "courses" ? { id: 1, title: "Course", source_url: null }
      : table === "course_splits" ? null
      : [{ id: 1, title: "Lesson", text_content: "<p>Overview.</p>", estimated_duration: 12, levels: ["beginner"], quiz_settings: null, quiz_questions: [{ id: 7 }] }]
    return {
      select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
      maybeSingle: async () => ({ data, error: null }),
      then(resolve) { return Promise.resolve({ data, error: null }).then(resolve) },
    }
  } }
  const route = load(file, {
    "next/server": { NextResponse },
    "@/lib/course-import/server": { requireImportAdmin: async () => ({ db, user: { id: "admin" } }) },
    "@/lib/course-import/adapters/html": { parseSourceHtml: () => ({ text: "Overview." }) },
    "@/lib/course-import/thumbnail": {}, "@/lib/lesson-levels": levels, "@/lib/course-import/split": {},
    "@/lib/storage/server": {}, "@/lib/storage/shared": {},
    "@/lib/utils/errorHandler": { logError() {} },
  })
  const response = await route.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "1" }) })
  assert.equal(response.status, 200)
  const { lessons } = await response.json()
  assert.deepEqual(sectionTime(lessons), { minutes: 15, pdHours: 0.25 })
})
