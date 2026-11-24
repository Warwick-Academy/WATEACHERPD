const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

function loadRoute(relative, mocks) {
  const file = path.join(__dirname, "..", "..", "app", "api", ...relative.split("/"), "route.ts")
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", code)((id) => id in mocks ? mocks[id] : require(id), module, module.exports)
  return module.exports
}

function mockDatabase(role = "admin") {
  const state = {
    user: { id: "caller" },
    profiles: [{ id: "caller", user_type: role }, { id: "teacher", user_type: "user", name: "Teacher" }],
    courses: [{ id: 1, title: "Course", is_published: true }],
    enrollments: [{ id: "e1", user_id: "teacher", course_id: 1, status: "completed", progress: 100, completed_at: "2026-01-01" }],
    created: [],
    deleted: [],
    failProfile: false,
  }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      admin: {
        createUser: async (data) => {
          state.created.push(data)
          state.profiles.push({ id: "new-user", email: data.email, name: data.user_metadata.name, user_type: "user" })
          return { data: { user: { id: "new-user" } }, error: null }
        },
        deleteUser: async (id) => { state.deleted.push(id); return { error: null } },
      },
    },
    from(table) {
      let filters = []
      let action = "select"
      let payload
      let single = false
      const builder = {
        select() { return this },
        eq(key, value) { filters.push((row) => String(row[key]) === String(value)); return this },
        neq(key, value) { filters.push((row) => String(row[key]) !== String(value)); return this },
        in(key, values) { filters.push((row) => values.includes(row[key])); return this },
        order() { return this },
        update(value) { action = "update"; payload = value; return this },
        insert(value) { action = "insert"; payload = value; return this },
        single() { single = true; return this },
        maybeSingle() { single = true; return this },
        then(resolve, reject) {
          try {
            if (state.failProfile && table === "profiles" && action === "update") {
              return Promise.resolve({ data: null, error: new Error("Profile failed") }).then(resolve, reject)
            }
            const rows = state[table] || []
            let result = rows.filter((row) => filters.every((filter) => filter(row)))
            if (action === "update") result.forEach((row) => Object.assign(row, payload))
            if (action === "insert") {
              result = [{ id: "new-enrollment", ...payload }]
              rows.push(...result)
            }
            return Promise.resolve({ data: single ? (result[0] ?? null) : result, count: result.length, error: null }).then(resolve, reject)
          } catch (error) { return Promise.reject(error).then(resolve, reject) }
        },
      }
      return builder
    },
  }
  const mocks = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => client, createServiceRoleClient: () => client },
    "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {}, createErrorResponse: () => ({ error: "Database error" }) },
    "@/lib/quiz/course-eligibility": { hasPassedCourseQuizzes: async () => true },
  }
  return { state, client, mocks }
}

test("admin creation uses service auth, confirms email, updates trigger profile and returns password once", async () => {
  const db = mockDatabase()
  const route = loadRoute("users", db.mocks)
  const request = (body) => ({ json: async () => body })
  const created = await route.POST(request({ email: "Staff@Example.com", name: "Staff", userType: "admin", generatePassword: true }))
  assert.equal(created.status, 201)
  assert.equal(created.body.user.user_type, "admin")
  assert.equal(created.body.temporaryPassword, db.state.created[0].password)
  assert.equal(db.state.created[0].email, "staff@example.com")
  assert.equal(db.state.created[0].email_confirm, true)
  assert.ok(created.body.temporaryPassword.length >= 20)
  const invalid = await route.POST(request({ email: "x@example.com", name: "X", userType: "instructor", password: "password" }))
  assert.equal(invalid.status, 400)
  db.state.profiles[0].user_type = "user"
  const forbidden = await route.POST(request({ email: "x@example.com", name: "X", userType: "user", generatePassword: true }))
  assert.equal(forbidden.status, 403)
})

test("failed profile update rolls back created auth user", async () => {
  const db = mockDatabase()
  db.state.failProfile = true
  const route = loadRoute("users", db.mocks)
  const response = await route.POST({ json: async () => ({ email: "x@example.com", name: "X", userType: "user", generatePassword: true }) })
  assert.equal(response.status, 500)
  assert.deepEqual(db.state.deleted, ["new-user"])
})

test("account actions require admin authorization and use the auth account email", async () => {
  const db = mockDatabase()
  const calls = []
  let account = { id: "teacher", email: "auth@example.com", email_confirmed_at: null }
  db.client.auth.admin.getUserById = async (id) => ({
    data: { user: id === account.id ? account : null },
    error: null,
  })
  db.client.auth.admin.updateUserById = async (id, attributes) => {
    calls.push({ id, attributes })
    return { error: null }
  }
  db.client.auth.resend = async (attributes) => {
    calls.push(attributes)
    return { error: null }
  }
  const route = loadRoute("admin/users/[id]/account", db.mocks)
  const context = { params: Promise.resolve({ id: "teacher" }) }
  const request = (body) => ({ headers: new Headers({ "content-type": "application/json" }), json: async () => body })
  db.state.user = null
  assert.equal((await route.POST(request({ action: "reset-password", password: "new-password" }), context)).status, 401)
  assert.equal((await route.POST(request({ action: "confirm-email" }), context)).status, 401)
  db.state.user = { id: "caller" }
  db.state.profiles[0].user_type = "user"
  assert.equal((await route.GET({}, context)).status, 403)
  assert.equal((await route.POST(request({ action: "resend-confirmation" }), context)).status, 403)
  assert.equal((await route.POST(request({ action: "confirm-email" }), context)).status, 403)
  assert.deepEqual(calls, [])
  db.state.profiles[0].user_type = "admin"
  assert.deepEqual((await route.GET({}, context)).body, { email: "auth@example.com", emailConfirmed: false })
  assert.equal((await route.POST(request({ action: "reset-password", password: "short" }), context)).status, 400)
  assert.equal((await route.POST(request({ action: "unknown" }), context)).status, 400)
  assert.equal((await route.POST({ headers: new Headers({ "content-type": "text/plain" }), json: async () => ({ action: "resend-confirmation" }) }, context)).status, 415)
  assert.equal((await route.POST(request({ action: "resend-confirmation", email: "other@example.com" }), context)).status, 200)
  assert.deepEqual(calls[0], { type: "signup", email: "auth@example.com" })
  assert.equal((await route.POST(request({ action: "reset-password", password: "new-password" }), context)).status, 200)
  assert.deepEqual(calls[1], { id: "teacher", attributes: { password: "new-password" } })
  assert.equal((await route.POST(request({ action: "confirm-email" }), context)).status, 200)
  assert.deepEqual(calls[2], { id: "teacher", attributes: { email_confirm: true } })
  account = { ...account, email_confirmed_at: "2026-01-01" }
  assert.equal((await route.POST(request({ action: "resend-confirmation" }), context)).status, 409)
  assert.equal((await route.POST(request({ action: "confirm-email" }), context)).status, 409)
  assert.equal(calls.length, 3)
  account = { ...account, email: null, email_confirmed_at: null }
  assert.equal((await route.POST(request({ action: "resend-confirmation" }), context)).status, 400)
  assert.equal((await route.POST(request({ action: "confirm-email" }), context)).status, 400)
  assert.equal((await route.GET({}, { params: Promise.resolve({ id: "missing" }) })).status, 404)
  assert.equal((await route.POST(request({ action: "confirm-email" }), { params: Promise.resolve({ id: "missing" }) })).status, 404)
})

test("account actions surface provider and configuration failures", async () => {
  const db = mockDatabase()
  db.client.auth.admin.getUserById = async () => ({ data: { user: { id: "teacher", email: "a@example.com", email_confirmed_at: null } }, error: null })
  db.client.auth.resend = async () => ({ error: new Error("rate limited") })
  db.client.auth.admin.updateUserById = async () => ({ error: new Error("update failed") })
  const route = loadRoute("admin/users/[id]/account", db.mocks)
  const context = { params: Promise.resolve({ id: "teacher" }) }
  const request = (body) => ({ headers: new Headers({ "content-type": "application/json" }), json: async () => body })
  assert.equal((await route.POST(request({ action: "resend-confirmation" }), context)).status, 400)
  assert.equal((await route.POST(request({ action: "reset-password", password: "new-password" }), context)).status, 400)
  assert.equal((await route.POST(request({ action: "confirm-email" }), context)).status, 400)
  db.mocks["@/lib/supabase/server"].createServiceRoleClient = () => { throw new Error("missing service key") }
  assert.equal((await route.GET({}, context)).status, 500)
})

test("signup confirmation verifies the email token and reports invalid or unavailable links", async () => {
  const db = mockDatabase()
  const calls = []
  let failure = null
  db.client.auth.verifyOtp = async (attributes) => {
    calls.push(attributes)
    return { error: failure }
  }
  const route = loadRoute("auth/confirm-email", db.mocks)
  assert.equal(route.GET, undefined)
  const request = (body) => ({ json: async () => body })
  assert.equal((await route.POST(request({ tokenHash: "" }))).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await route.POST(request({ tokenHash: "signup-token" }))).status, 200)
  assert.deepEqual(calls[0], { token_hash: "signup-token", type: "email" })
  failure = { status: 403 }
  assert.equal((await route.POST(request({ tokenHash: "expired-token" }))).status, 400)
  failure = { status: 503 }
  assert.equal((await route.POST(request({ tokenHash: "signup-token" }))).status, 503)
})

test("login exposes an unconfirmed email error for confirmation guidance", async () => {
  const db = mockDatabase()
  db.client.auth.signInWithPassword = async () => ({
    data: { user: null, session: null },
    error: { message: "Email not confirmed", code: "email_not_confirmed" },
  })
  const route = loadRoute("auth/login", db.mocks)
  const response = await route.POST({ json: async () => ({ email: "a@example.com", password: "password", userType: "user" }) })
  assert.equal(response.status, 401)
  assert.equal(response.body.code, "email_not_confirmed")
})

test("only admins may cancel or restore assignments and completion history survives", async () => {
  const db = mockDatabase()
  const route = loadRoute("enrollments", db.mocks)
  const request = (body) => ({ json: async () => body })
  db.state.profiles[0].user_type = "user"
  const forbidden = await route.PATCH(request({ userId: "teacher", courseId: 1, status: "cancelled" }))
  assert.equal(forbidden.status, 403)
  db.state.profiles[0].user_type = "admin"
  const cancelled = await route.PATCH(request({ userId: "teacher", courseId: 1, status: "cancelled" }))
  assert.equal(cancelled.status, 200)
  assert.equal(db.state.enrollments[0].progress, 100)
  assert.equal(db.state.enrollments[0].completed_at, "2026-01-01")
  assert.equal(db.state.courses[0].enrolled_students, 0)
  db.state.user = { id: "teacher" }
  const selfRestore = await route.PATCH(request({ courseId: 1, status: "active" }))
  assert.equal(selfRestore.status, 403)
  const selfEnroll = await route.POST(request({ courseId: 1 }))
  assert.equal(selfEnroll.status, 403)
  db.state.user = { id: "caller" }
  const restored = await route.POST(request({ userId: "teacher", courseId: 1 }))
  assert.equal(restored.status, 200)
  assert.equal(db.state.enrollments[0].status, "completed")
  assert.equal(db.state.enrollments[0].progress, 100)
  assert.equal(db.state.courses[0].enrolled_students, 1)
  const duplicate = await route.POST(request({ userId: "teacher", courseId: 1 }))
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.code, "already_enrolled")
  db.state.courses[0].is_published = false
  const draft = await route.POST(request({ userId: "teacher", courseId: 1 }))
  assert.equal(draft.status, 400)
})

test("CSV preview handles quoting, duplicates and invalid roles; export neutralizes formulas", () => {
  const file = path.join(__dirname, "user-import.ts")
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: typescript.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function("module", "exports", code)(module, module.exports)
  const { parseUserCsv, exportUserResults } = module.exports
  const rows = parseUserCsv('name,email,role\r\n"Doe, Jane",jane@example.com,teacher\r\nOther,JANE@example.com,\r\nBad,bad@example.com,instructor\r\nExisting,existing@example.com,admin', ["existing@example.com"])
  assert.equal(rows[0].name, "Doe, Jane")
  assert.equal(rows[0].error, undefined)
  assert.match(rows[1].error, /Duplicate/)
  assert.match(rows[2].error, /Role/)
  assert.match(rows[3].error, /exists/)
  assert.throws(() => parseUserCsv('name,email\n"broken,email', []), /Unclosed/)
  assert.match(exportUserResults([{ name: "=1+1", email: "a@b.com", password: "Aa1!test", status: "Created" }]), /"'=1\+1"/)
})

test("bulk assignment skips existing courses and reports partial failures", async (t) => {
  const file = path.join(__dirname, "assignments.ts")
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: typescript.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function("module", "exports", code)(module, module.exports)
  const requests = []
  const originalFetch = global.fetch
  t.after(() => { global.fetch = originalFetch })
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    return body.userId === "second"
      ? { ok: false, status: 500, json: async () => ({ error: "Database unavailable" }) }
      : { ok: true, status: 200 }
  }
  const result = await module.exports.assignCourses([
    { id: "first", name: "First", enrolledCourses: [1] },
    { id: "second", name: "Second", enrolledCourses: [] },
  ], [1, 2])
  assert.equal(result.assigned, 1)
  assert.equal(result.failures.length, 2)
  assert.match(result.failures[0], /Database unavailable/)
  assert.equal(requests.length, 3)
})
