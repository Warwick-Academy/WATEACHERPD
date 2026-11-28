const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const typescript = require("typescript")

function load(file, mocks = {}) {
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, esModuleInterop: true, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function("require", "module", "exports", code)((id) => id in mocks ? mocks[id] : require(id), mod, mod.exports)
  return mod.exports
}

const owner = "31d5e0bb-fc78-4980-a969-1097e27cb101"
const leader = "31d5e0bb-fc78-4980-a969-1097e27cb102"
const stranger = "31d5e0bb-fc78-4980-a969-1097e27cb103"
function fixtures(viewer, role = "user") {
  const tables = {
    profiles: [{ id: owner, name: "Teacher", user_type: "user" }, { id: leader, name: "Leader", user_type: "user" }, { id: stranger, name: "Other", user_type: role }],
    pd_academic_years: [{ id: 1, name: "2026", is_current: true }],
    pd_feedback_assignments: [{ id: 1, leader_id: leader, staff_id: owner, year_id: 1 }],
    pd_goals: [{ id: "goal", user_id: owner, year_id: 1, title: "Improve", status: "on_track", smart_description: "Practise" }],
    pd_goal_updates: [{ id: "update", goal_id: "goal", author_id: owner, note: "Progress made", created_at: "2026-01-01" }],
    pd_observations: [{ id: "published", teacher_id: owner, observer_id: leader, year_id: 1, form_type: "appraisal", status: "published", observation_date: "2026-02-01", teacher_response: "My response" }, { id: "draft", teacher_id: owner, observer_id: leader, year_id: 1, form_type: "appraisal", status: "draft", observation_date: "2026-02-02", comment: "PRIVATE DRAFT" }],
    pd_observation_sections: [], pd_observation_ratings: [], pd_obs_categories: [], pd_obs_criteria: [],
    pd_cpd_activities: [{ id: "cpd", user_id: owner, year_id: 1, title: "Workshop", hours: 2, activity_type: "other", activity_date: "2026-03-01" }],
  }
  const calls = []
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: viewer } }, error: null }) },
    from(table) {
      calls.push(table)
      let rows = tables[table] || []
      const builder = {
        select() { return this },
        eq(key, value) { rows = rows.filter((row) => row[key] === value); return this },
        neq(key, value) { rows = rows.filter((row) => row[key] !== value); return this },
        in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this },
        order() { return this },
        range(from, to) { rows = rows.slice(from, to + 1); return this },
        single() { return Promise.resolve({ data: rows[0], error: rows.length ? null : { message: "Not found" } }) },
        maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }) },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
  return { client, calls }
}

function route(db, PDFDocument) {
  return load(path.join(__dirname, "..", "..", "app", "api", "pd", "portfolio", "route.ts"), {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/server": { createClient: async () => db.client },
    "@/lib/certificates/pdfkit-font-patch": {},
    "@/lib/utils/errorHandler": { logError() {} },
    "@/lib/pd/report-utils": load(path.join(__dirname, "report-utils.ts")),
    "@/lib/pd/observation-ui": load(path.join(__dirname, "observation-ui.ts")),
    pdfkit: PDFDocument,
  })
}
const request = () => new Request(`http://localhost/api/pd/portfolio?userId=${owner}&yearId=1`)

test("portfolio rejects an unassigned person before reading confidential records", async () => {
  const db = fixtures(stranger)
  const response = await route(db, require("pdfkit")).GET(request())
  assert.equal(response.status, 403)
  assert.equal(db.calls.includes("pd_goals"), false)
  assert.equal(db.calls.includes("pd_observations"), false)
})

test("portfolio includes visible records and never includes drafts", async () => {
  let document
  class RecordingDocument extends EventEmitter {
    constructor() { super(); document = this; this.texts = [] }
    image() { return this } font() { return this } fontSize() { return this } fillColor() { return this } moveDown() { return this }
    text(value) { this.texts.push(String(value)); return this }
    end() { this.emit("data", Buffer.from("%PDF-test")); this.emit("end") }
  }
  const response = await route(fixtures(leader), RecordingDocument).GET(request())
  assert.equal(response.status, 200)
  const text = document.texts.join(" ")
  for (const value of ["Teacher", "Improve", "Progress made", "My response", "Workshop", "Total: 2 hours"]) assert.ok(text.includes(value), value)
  assert.ok(!text.includes("PRIVATE DRAFT"))
  assert.equal(response.headers.get("cache-control"), "private, no-store")
})

test("owner can generate a PDFKit portfolio", async () => {
  const response = await route(fixtures(owner), require("pdfkit")).GET(request())
  assert.equal(response.status, 200)
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-")
})
