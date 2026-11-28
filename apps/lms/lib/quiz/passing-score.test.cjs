const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

function loadTypeScript(name) {
  const file = path.join(__dirname, `${name}.ts`)
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS },
  }).outputText
  const module = { exports: {} }
  const localRequire = (id) => id.startsWith("./") ? loadTypeScript(id.slice(2)) : require(id)
  new Function("require", "module", "exports", code)(localRequire, module, module.exports)
  return module.exports
}

const { getPassingScore } = loadTypeScript("passing-score")
const { getQuizPercentage, isQuizAnswerCorrect } = loadTypeScript("grading")
const { hasPassedCourseQuizzes, hasCompletedCourseLessons } = loadTypeScript("course-eligibility")

test("quiz score overrides course score, with null fallback and zero preserved", () => {
  assert.equal(getPassingScore(80, 50), 80)
  assert.equal(getPassingScore(null, 50), 50)
  assert.equal(getPassingScore(0, 50), 0)
  assert.equal(getPassingScore(null, 0), 0)
  assert.equal(getPassingScore(null, null), 50)
})

const questions = [
  { id: 1, question_type: "multiple-choice", question_data: { correctOption: 1 }, points: 4 },
  { id: 2, question_type: "true-false", question_data: { correctAnswer: false }, points: 1 },
]

test("quiz grading uses weighted answers and rejects incomplete or duplicate results", () => {
  const results = [
    { quiz_question_id: 1, user_answer: "1" },
    { quiz_question_id: 2, user_answer: "0" },
  ]
  assert.equal(getQuizPercentage(questions, results), 80)
  assert.equal(getQuizPercentage(questions, results.slice(0, 1)), null)
  assert.equal(getQuizPercentage(questions, [results[0], results[0]]), null)
  assert.equal(getQuizPercentage(questions, [results[0], { quiz_question_id: 99, user_answer: "0" }]), null)
  assert.equal(isQuizAnswerCorrect("multiple-choice", { correctOption: 0 }, null), false)
  assert.equal(isQuizAnswerCorrect("true-false", { correctAnswer: false }, "1"), true)
  assert.equal(isQuizAnswerCorrect("fill-blank", { correctAnswers: ["Answer"] }, "answer"), true)
  assert.equal(isQuizAnswerCorrect("short-answer", { correctKeywords: ["teacher"] }, "A Teacher"), true)
})

function mockDatabase(tables) {
  return {
    from(table) {
      let rows = tables[table]
      const builder = {
        select() { return this },
        eq(column, value) { rows = rows.filter((row) => row[column] === value); return this },
        in(column, values) { rows = rows.filter((row) => values.includes(row[column])); return this },
        single() { return Promise.resolve({ data: rows[0], error: rows.length ? null : new Error("Missing row") }) },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }) },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
}

function loadQuizResultsRoute(client) {
  const file = path.join(__dirname, "..", "..", "app", "api", "courses", "[id]", "quiz-results", "route.ts")
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/slug": { extractIdFromSlug: (id) => id },
    "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {} },
    "@/lib/quiz/grading": loadTypeScript("grading"),
    "@/lib/supabase/server": {
      createClient: async () => client,
      createServiceRoleClient: () => client,
    },
  }
  const module = { exports: {} }
  new Function("require", "module", "exports", code)(
    (id) => mocks[id] ?? require(id), module, module.exports
  )
  return module.exports
}

test("quiz submission rejects incomplete, duplicated and cross-course answers", async () => {
  const tables = {
    enrollments: [{ user_id: "teacher", course_id: 10, status: "active" }],
    lessons: [{ id: 20, course_id: 10 }],
    quiz_questions: questions.map((question) => ({ ...question, lesson_id: 20 })),
  }
  const database = mockDatabase(tables)
  const from = database.from
  database.from = (table) => {
    const builder = from(table)
    builder.order = function () { return this }
    return builder
  }
  database.auth = { getUser: async () => ({ data: { user: { id: "teacher" } } }) }
  const { POST } = loadQuizResultsRoute(database)
  const submit = (lessonId, answers) => POST(
    { json: async () => ({ lessonId, answers }) },
    { params: Promise.resolve({ id: "10" }) }
  )

  assert.equal((await submit(20, [{ questionId: 1, userAnswer: 1 }])).status, 400)
  assert.equal((await submit(20, [{ questionId: 1, userAnswer: 1 }, { questionId: 1, userAnswer: 1 }])).status, 400)
  assert.equal((await submit(20, [null, { questionId: 2, userAnswer: 1 }])).status, 400)
  assert.equal((await submit(99, [{ questionId: 1, userAnswer: 1 }])).status, 400)
})

test("completion and certificate eligibility require every enabled quiz to meet its own score", async () => {
  const tables = {
    courses: [{ id: 10, minimum_quiz_score: 50 }],
    lessons: [{ id: 20, course_id: 10 }, { id: 21, course_id: 10 }],
    quiz_settings: [
      { lesson_id: 20, enabled: true, passing_score: 80 },
      { lesson_id: 21, enabled: true, passing_score: null },
    ],
    quiz_questions: [
      ...questions.map((question) => ({ ...question, lesson_id: 20 })),
      { id: 3, lesson_id: 21, question_type: "true-false", question_data: { correctAnswer: true }, points: 1 },
    ],
    quiz_results: [
      { user_id: "teacher", course_id: 10, lesson_id: 20, quiz_question_id: 1, user_answer: "1" },
      { user_id: "teacher", course_id: 10, lesson_id: 20, quiz_question_id: 2, user_answer: "0" },
      { user_id: "teacher", course_id: 10, lesson_id: 21, quiz_question_id: 3, user_answer: "0" },
    ],
  }
  assert.equal(await hasPassedCourseQuizzes(mockDatabase(tables), "teacher", 10), true)
  tables.quiz_settings[0].passing_score = 81
  assert.equal(await hasPassedCourseQuizzes(mockDatabase(tables), "teacher", 10), false)
  tables.quiz_settings[0].passing_score = 0
  tables.quiz_results.pop()
  assert.equal(await hasPassedCourseQuizzes(mockDatabase(tables), "teacher", 10), false)
  tables.quiz_settings[1].enabled = false
  assert.equal(await hasPassedCourseQuizzes(mockDatabase(tables), "teacher", 10), true)
})

test("course completion requires every lesson and never treats an empty course as completed", async () => {
  const tables = {
    lessons: [{ id: 20, course_id: 10 }, { id: 21, course_id: 10 }],
    progress: [
      { user_id: "teacher", course_id: 10, lesson_id: 20, completed: true },
      { user_id: "teacher", course_id: 10, lesson_id: 21, completed: false },
      { user_id: "other", course_id: 10, lesson_id: 21, completed: true },
    ],
  }
  assert.equal(await hasCompletedCourseLessons(mockDatabase(tables), "teacher", 10), false)
  tables.progress[1].completed = true
  assert.equal(await hasCompletedCourseLessons(mockDatabase(tables), "teacher", 10), true)
  assert.equal(await hasCompletedCourseLessons(mockDatabase(tables), "teacher", 99), false)
})
