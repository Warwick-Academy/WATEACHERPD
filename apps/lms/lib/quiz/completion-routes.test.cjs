const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

function load(file, mocks = {}) {
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function("require", "module", "exports", code)((id) => {
    if (id in mocks) return mocks[id]
    if (id.startsWith("./")) return load(path.join(__dirname, `${id.slice(2)}.ts`))
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

function database(tables) {
  const writes = []
  return {
    writes,
    errors: {},
    from(table) {
      let rows = tables[table] || []
      const error = this.errors[table]
      let action = null
      let payload
      const builder = {
        select() { return this },
        eq(column, value) { rows = rows.filter((row) => row[column] === value); return this },
        neq(column, value) { rows = rows.filter((row) => row[column] !== value); return this },
        in(column, values) { rows = rows.filter((row) => values.includes(row[column])); return this },
        upsert(value) { action = "upsert"; payload = value; return this },
        update(value) { action = "update"; payload = value; return this },
        single() {
          if (action) { writes.push({ table, action, payload }); return Promise.resolve({ data: { id: "saved", ...payload }, error: null }) }
          return Promise.resolve({ data: rows[0] ?? null, error: error ?? (rows.length ? null : { code: "PGRST116", message: "Not found" }) })
        },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: error ?? null }) },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: error ?? null }).then(resolve, reject) },
      }
      return builder
    },
  }
}

function routes(service) {
  const signedIn = { auth: { getUser: async () => ({ data: { user: { id: "teacher" } } }) }, from() { throw new Error("Unexpected signed-in database write") } }
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => signedIn, createServiceRoleClient: () => service },
    "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {} },
    "@/lib/quiz/course-eligibility": load(path.join(__dirname, "course-eligibility.ts")),
  }
  return {
    progress: load(path.join(__dirname, "..", "..", "app", "api", "progress", "route.ts"), mocks),
    enrollments: load(path.join(__dirname, "..", "..", "app", "api", "enrollments", "route.ts"), mocks),
  }
}
function fixtures() {
  return {
    enrollments: [{ id: "enrollment", user_id: "teacher", course_id: 10, status: "active" }],
    courses: [{ id: 10, minimum_quiz_score: 50 }],
    lessons: [{ id: 20, course_id: 10 }, { id: 21, course_id: 10 }],
    progress: [{ user_id: "teacher", course_id: 10, lesson_id: 20, completed: true }],
    quiz_settings: [{ lesson_id: 20, enabled: true, passing_score: 80 }],
    quiz_questions: [{ id: 1, lesson_id: 20, question_type: "true-false", question_data: { correctAnswer: true }, points: 1 }],
    quiz_results: [{ user_id: "teacher", course_id: 10, lesson_id: 20, quiz_question_id: 1, user_answer: "1" }],
  }
}

test("enrolment completion requires all lessons and each quiz to pass", async () => {
  const tables = fixtures()
  const db = database(tables)
  const { enrollments } = routes(db)
  const request = () => ({ json: async () => ({ courseId: 10, status: "completed" }) })
  assert.equal((await enrollments.PATCH(request())).status, 400)
  tables.progress.push({ user_id: "teacher", course_id: 10, lesson_id: 21, completed: true })
  assert.equal((await enrollments.PATCH(request())).status, 400)
  assert.equal(db.writes.length, 0)
  tables.quiz_results[0].user_answer = "0"
  tables.quiz_settings.push({ lesson_id: 21, enabled: true, passing_score: 100 })
  tables.quiz_questions.push({ id: 2, lesson_id: 21, question_type: "true-false", question_data: { correctAnswer: true }, points: 1 })
  assert.equal((await enrollments.PATCH(request())).status, 400)
  tables.quiz_results.push({ user_id: "teacher", course_id: 10, lesson_id: 21, quiz_question_id: 2, user_answer: "0" })
  db.errors.progress = { message: "Database unavailable" }
  assert.equal((await enrollments.PATCH(request())).status, 500)
  delete db.errors.progress
  assert.equal(db.writes.length, 0)
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: true })
  try {
    assert.equal((await enrollments.PATCH(request())).status, 200)
    assert.equal(db.writes[0].payload.status, "completed")
    tables.enrollments[0].status = "completed"
    assert.equal((await enrollments.PATCH(request())).status, 200)
    assert.equal(db.writes.length, 1)
  } finally { global.fetch = originalFetch }
})

test("progress writes require enrolment, lesson ownership and a passing quiz", async () => {
  const tables = fixtures()
  const db = database(tables)
  const { progress } = routes(db)
  const request = (body) => ({ json: async () => body })
  const payload = { course_id: 10, lesson_id: 20, completed: true }
  assert.equal((await progress.POST(request(payload))).status, 400)
  assert.equal((await progress.POST(request({ ...payload, lesson_id: 99 }))).status, 403)
  assert.equal((await progress.POST(request({ ...payload, user_id: "another" }))).status, 400)
  tables.enrollments[0].status = "cancelled"
  assert.equal((await progress.POST(request(payload))).status, 403)
  tables.enrollments[0].status = "active"
  tables.quiz_results[0].user_answer = "0"
  assert.equal((await progress.POST(request(payload))).status, 200)
  assert.equal(db.writes[0].payload.user_id, "teacher")
  assert.equal(db.writes[0].payload.completed, true)
})
