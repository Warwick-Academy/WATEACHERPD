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
  new Function("require", "module", "exports", code)((id) => id in mocks ? mocks[id] : require(id), mod, mod.exports)
  return mod.exports
}
const helper = load(path.join(__dirname, "staff-preview.ts"), { "./report-utils": load(path.join(__dirname, "report-utils.ts")) })
const admin = "31d5e0bb-fc78-4980-a969-1097e27cb101"
const selected = "31d5e0bb-fc78-4980-a969-1097e27cb102"
const team = "31d5e0bb-fc78-4980-a969-1097e27cb103"
const other = "31d5e0bb-fc78-4980-a969-1097e27cb104"

function database(role = "admin") {
  const tables = {
    profiles: [
      { id: admin, name: "Admin", user_type: role, is_active: true },
      { id: selected, name: "Leader", user_type: "user", is_active: true },
      { id: team, name: "Team member", user_type: "user", is_active: true },
      { id: other, name: "Other", user_type: "user", is_active: true },
    ],
    pd_academic_years: [{ id: 1, name: "Current", is_current: true }],
    pd_settings: [{ id: 1, annual_cpd_target_hours: 10 }],
    pd_goals: [{ id: "own", user_id: selected, year_id: 1 }, { id: "old", user_id: selected, year_id: 2 }, { id: "team", user_id: team, year_id: 1 }, { id: "other", user_id: other, year_id: 1 }],
    pd_cpd_activities: [{ id: "own", user_id: selected, year_id: 1, hours: 2 }, { id: "team", user_id: team, year_id: 1, hours: 3 }, { id: "other", user_id: other, year_id: 1, hours: 4 }],
    pd_observations: [
      { id: "about", teacher_id: selected, observer_id: other, year_id: 1, status: "published" },
      { id: "written", teacher_id: other, observer_id: selected, year_id: 1, status: "signed" },
      { id: "draft", teacher_id: selected, observer_id: selected, year_id: 1, status: "draft" },
      { id: "team", teacher_id: team, observer_id: other, year_id: 1, status: "published" },
      { id: "team-draft", teacher_id: team, observer_id: other, year_id: 1, status: "draft" },
      { id: "unrelated", teacher_id: other, observer_id: other, year_id: 1, status: "published" },
    ],
    pd_feedback_assignments: [{ leader_id: selected, staff_id: team, year_id: 1 }, { leader_id: other, staff_id: other, year_id: 1 }],
    enrollments: [{ id: "enrolled", user_id: selected, course_id: 1, status: "active" }, { id: "cancelled", user_id: selected, course_id: 2, status: "cancelled" }, { id: "other", user_id: other, course_id: 2, status: "active" }],
    courses: [{ id: 1, title: "Course" }, { id: 2, title: "Other course" }],
  }
  const calls = []
  return {
    tables, calls,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: admin } }, error: null }) },
      from(table) {
        calls.push(table)
        let rows = tables[table]
        const builder = {
          select() { return this },
          eq(key, value) { rows = rows.filter((row) => row[key] === value); return this },
          neq(key, value) { rows = rows.filter((row) => row[key] !== value); return this },
          in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this },
          order() { return this },
          range(from, to) { rows = rows.slice(from, to + 1); return this },
          single() { return Promise.resolve({ data: rows[0], error: rows.length ? null : { message: "Not found" } }) },
          then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject) },
        }
        return builder
      },
    },
  }
}

test("read-only preview scopes personal records and team data and excludes all drafts", async () => {
  const db = database()
  const result = await helper.getStaffPreview(db.client, selected)
  assert.deepEqual(result.goals.map((goal) => goal.id), ["own"])
  assert.deepEqual(result.cpd.map((entry) => entry.id), ["own"])
  assert.deepEqual(result.observations.map((observation) => observation.id).sort(), ["about", "written"])
  assert.deepEqual(result.team.map((person) => person.id), [team])
  assert.deepEqual(result.teamGoals.map((goal) => goal.id), ["team"])
  assert.deepEqual(result.teamObservations.map((item) => item.id), ["team"])
  assert.deepEqual(result.enrollments.map((entry) => entry.id), ["enrolled"])
  assert.deepEqual(result.courses.map((course) => course.title), ["Course"])
})

test("preview rejects non-admins before reading private data", async () => {
  const db = database("user")
  await assert.rejects(helper.getStaffPreview(db.client, selected), /Only administrators/)
  assert.deepEqual(db.calls, ["profiles"])
  await assert.rejects(helper.getStaffPreview(db.client, "invalid"), /Invalid staff member/)
})

test("an admin account preview shows active staff in its team", async () => {
  const db = database()
  db.tables.profiles[1].user_type = "admin"
  db.tables.profiles[3].is_active = false
  const result = await helper.getStaffPreview(db.client, selected)
  assert.deepEqual(result.team.map((person) => person.id).sort(), [admin, team].sort())
})
