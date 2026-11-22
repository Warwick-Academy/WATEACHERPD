const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

function loadTypeScript(file, mocks = {}) {
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", code)((id) => {
    if (id in mocks) return mocks[id]
    return require(id)
  }, module, module.exports)
  return module.exports
}

const levels = loadTypeScript(path.join(__dirname, "lesson-levels.ts"))

test("validates levels and derives an ordered course union", () => {
  assert.equal(levels.isLessonLevelArray([]), true)
  assert.equal(levels.isLessonLevelArray(["advanced", "beginner"]), true)
  assert.equal(levels.isLessonLevelArray(["Beginner"]), false)
  assert.equal(levels.isLessonLevelArray(null), false)
  assert.equal(levels.isLessonLevelArray(["beginner", 1]), false)
  assert.deepEqual(levels.getCourseLevels([{ levels: ["advanced", "beginner"] }, { levels: ["advanced", "intermediate"] }, {}]), ["beginner", "intermediate", "advanced"])
  assert.deepEqual(levels.getCourseLevels([]), [])
})

test("quiz difficulty uses the lowest level regardless of selection order", () => {
  assert.equal(levels.getQuizDifficulty([]), "medium")
  assert.equal(levels.getQuizDifficulty(["advanced"]), "hard")
  assert.equal(levels.getQuizDifficulty(["advanced", "intermediate"]), "medium")
  assert.equal(levels.getQuizDifficulty(["advanced", "beginner"]), "easy")
})

function mockDatabase() {
  const tables = {
    profiles: [{ id: "admin", user_type: "admin" }],
    courses: [{ id: 1, created_by: "admin", title: "Course", is_published: false }],
    lessons: [{ id: 10, course_id: 1, title: "Existing", type: "text", levels: [] }],
    quiz_settings: [],
    quiz_questions: [],
    lesson_resources: [],
    course_prerequisites: [],
    course_instructors: [],
    enrollments: [],
  }
  const state = { failLessonWrites: false }
  return {
    tables,
    state,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
      from(table) {
        let filters = []
        let action = "select"
        let payload
        let single = false
        let selection = "*"
        const builder = {
          select(columns = "*") { selection = columns; return this },
          eq(key, value) { filters.push((row) => String(row[key]) === String(value)); return this },
          neq(key, value) { filters.push((row) => String(row[key]) !== String(value)); return this },
          in(key, values) { filters.push((row) => values.includes(row[key])); return this },
          order() { return this },
          limit() { return this },
          update(value) { action = "update"; payload = value; return this },
          insert(value) { action = "insert"; payload = value; return this },
          upsert(value) { action = "upsert"; payload = value; return this },
          delete() { action = "delete"; return this },
          single() { single = true; return this },
          maybeSingle() { single = true; return this },
          then(resolve, reject) {
            try {
              if (table === "lessons" && state.failLessonWrites && (action === "update" || action === "insert")) {
                return Promise.resolve({ data: null, error: new Error("Lesson write failed") }).then(resolve, reject)
              }
              const rows = tables[table]
              let result = rows.filter((row) => filters.every((filter) => filter(row)))
              if (action === "delete") result.forEach((row) => rows.splice(rows.indexOf(row), 1))
              if (action === "update") result.forEach((row) => Object.assign(row, payload))
              if (action === "insert") {
                result = (Array.isArray(payload) ? payload : [payload]).map((row, index) => ({
                  ...(table === "lessons" ? { levels: [] } : {}),
                  ...row,
                  id: 20 + rows.length + index,
                }))
                rows.push(...result)
              }
              if (action === "upsert") {
                const existing = rows.find((row) => row.lesson_id === payload.lesson_id)
                if (existing) Object.assign(existing, payload)
                else rows.push({ ...payload })
                result = []
              }
              const project = (row, columns) => {
                if (columns.trim() === "*") return { ...row }
                return Object.fromEntries(columns.split(",").map((key) => key.trim()).filter((key) => key in row).map((key) => [key, row[key]]))
              }
              const converted = result.map((row) => {
                if (table === "lessons") return project(row, selection)
                const nested = table === "courses" && selection.match(/lessons\s*\(([^)]+)\)/)
                return nested
                  ? { ...row, lessons: tables.lessons.filter((lesson) => lesson.course_id === row.id).map((lesson) => project(lesson, nested[1])) }
                  : { ...row }
              })
              const data = single ? (converted[0] ?? null) : converted
              return Promise.resolve({ data, error: null }).then(resolve, reject)
            } catch (error) {
              return Promise.reject(error).then(resolve, reject)
            }
          },
        }
        return builder
      },
    },
  }
}

test("draft saves, publishes and reloads lesson levels; omitted legacy levels are preserved", async () => {
  const db = mockDatabase()
  const route = loadTypeScript(path.join(__dirname, "..", "app", "api", "courses", "drafts", "route.ts"), {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => db.client, createServiceRoleClient: () => db.client },
    "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {}, createErrorResponse: (error) => ({ error: String(error) }) },
    "@/lib/aws/s3": { transformVideoUrls: (value) => value },
    "@/lib/lesson-levels": levels,
  })
  const lesson = (id, selected) => ({ id, title: "Lesson", type: "text", content: {}, settings: {}, quiz: { enabled: false, questions: [] }, ...(selected === undefined ? {} : { levels: selected }) })
  const save = (lessons, isPublished = false) => route.POST({ json: async () => ({ courseId: 1, isPublished, courseData: { basicInfo: { title: "Course" }, lessons } }) })

  const invalid = await save([lesson("10", ["invalid"])])
  assert.equal(invalid.status, 400)
  assert.deepEqual(db.tables.lessons[0].levels, [])

  const saved = await save([lesson("10", ["beginner"]), lesson("lesson-copy", ["intermediate", "advanced"])], true)
  assert.equal(saved.status, 200, JSON.stringify(saved.body))
  assert.equal(db.tables.courses[0].is_published, true)
  assert.deepEqual(db.tables.lessons.map((row) => row.levels), [["beginner"], ["intermediate", "advanced"]])

  const reloaded = await route.GET({ url: "http://localhost/api/courses/drafts?courseId=1" })
  assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body))
  assert.deepEqual(reloaded.body.course.lessons.map((row) => row.levels), [["beginner"], ["intermediate", "advanced"]])

  const savedAgain = await save(db.tables.lessons.map((row) => lesson(String(row.id), undefined)))
  assert.equal(savedAgain.status, 200)
  assert.deepEqual(db.tables.lessons.map((row) => row.levels), [["beginner"], ["intermediate", "advanced"]])

  const cleared = await save(db.tables.lessons.map((row) => lesson(String(row.id), [])))
  assert.equal(cleared.status, 200)
  assert.deepEqual(db.tables.lessons.map((row) => row.levels), [[], []])

  db.state.failLessonWrites = true
  const failed = await save(db.tables.lessons.map((row) => lesson(String(row.id), ["advanced"])))
  assert.equal(failed.status, 500)
})

test("course list and detail expose lesson levels for learner badges", async () => {
  const db = mockDatabase()
  db.tables.courses[0].is_published = true
  db.tables.lessons[0].levels = ["beginner", "advanced"]
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => db.client, createServiceRoleClient: () => db.client },
    "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {}, createErrorResponse: (error) => ({ error: String(error) }) },
    "@/lib/aws/s3": { transformVideoUrls: (value) => value },
    "@/lib/slug": { extractIdFromSlug: (id) => id },
    "@/lib/quiz/shuffle": { shuffleQuiz: (questions) => questions, generateSeed: () => 1 },
  }
  const coursesDir = path.join(__dirname, "..", "app", "api", "courses")
  const listRoute = loadTypeScript(path.join(coursesDir, "route.ts"), mocks)
  const detailRoute = loadTypeScript(path.join(coursesDir, "[id]", "route.ts"), mocks)
  const list = await listRoute.GET({ url: "http://localhost/api/courses" })
  assert.equal(list.status, 200, JSON.stringify(list.body))
  assert.deepEqual(list.body.courses[0].lessons[0].levels, ["beginner", "advanced"])
  const detail = await detailRoute.GET({ url: "http://localhost/api/courses/1" }, { params: Promise.resolve({ id: "1" }) })
  assert.equal(detail.status, 200, JSON.stringify(detail.body))
  assert.deepEqual(detail.body.course.lessons[0].levels, ["beginner", "advanced"])
})

test("course preview hides lesson content from cancelled and anonymous viewers", async () => {
  const db = mockDatabase()
  db.tables.lessons[0].text_content = "<p>Private lesson text</p>"
  db.tables.lessons[0].video_url = "https://example.com/private-video"
  db.tables.profiles.push({ id: "teacher", user_type: "user" })
  db.tables.enrollments.push({ user_id: "teacher", course_id: 1, status: "cancelled" })
  db.client.auth.getUser = async () => ({ data: { user: { id: "teacher" } } })
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => db.client, createServiceRoleClient: () => db.client },
    "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {}, createErrorResponse: (error) => ({ error: String(error) }) },
    "@/lib/aws/s3": { transformVideoUrls: (value) => value },
    "@/lib/slug": { extractIdFromSlug: (id) => id },
    "@/lib/quiz/shuffle": { shuffleQuiz: (questions) => questions, generateSeed: () => 1 },
  }
  const route = loadTypeScript(path.join(__dirname, "..", "app", "api", "courses", "[id]", "route.ts"), mocks)
  const get = () => route.GET({ url: "http://localhost/api/courses/1" }, { params: Promise.resolve({ id: "1" }) })
  const cancelled = await get()
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  assert.equal(cancelled.body.course.lessons[0].html, undefined)
  assert.equal(cancelled.body.course.lessons[0].url, undefined)
  db.tables.enrollments[0].status = "active"
  const active = await get()
  assert.equal(active.body.course.lessons[0].html, "<p>Private lesson text</p>")
  assert.equal(active.body.course.lessons[0].url, "https://example.com/private-video")
  db.client.auth.getUser = async () => ({ data: { user: null } })
  const anonymous = await get()
  assert.equal(anonymous.body.course.lessons[0].html, undefined)
})
