const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

const source = fs.readFileSync(path.join(__dirname, "observation-draft.ts"), "utf8")
const output = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS } }).outputText
const mod = { exports: {} }
new Function("require", "module", "exports", output)(require, mod, mod.exports)
const { saveObservationDraft } = mod.exports

function client(failure) {
  const operations = []
  return {
    operations,
    from(table) {
      const current = { table, filters: [] }
      const query = {
        update(values) { current.action = "update"; current.values = values; operations.push(current); return query },
        upsert(values) { current.action = "upsert"; current.values = values; operations.push(current); return query },
        delete() { current.action = "delete"; operations.push(current); return query },
        eq(name, value) { current.filters.push([name, value]); return query },
        in(name, value) { current.filters.push([name, value]); return query },
        select() { return query },
        single() { return query },
        then(resolve, reject) { return Promise.resolve({ error: failure === `${table}:${current.action}` ? { message: "Database rejected save" } : null }).then(resolve, reject) },
      }
      return query
    },
  }
}

function input(supabase) {
  return {
    supabase,
    observation: { id: "observation", form_type: "appraisal" },
    viewerId: "writer",
    year: { start_date: "2026-09-01", end_date: "2027-08-31" },
    categories: [{ id: 1 }],
    criteria: [{ id: 10 }, { id: 11 }],
    values: {
      observation_date: "2026-11-27", year_group: "", subject: "Maths", comment: "",
      overall_comment: "Comment", overall_rating: "meeting",
      sections: { "1": { evidence_comment: "Evidence", reflection_questions: "Question" } },
      ratings: { "10": "sometimes", "11": "" },
    },
  }
}

test("saving a draft preserves teacher responses and deletes only cleared ratings", async () => {
  const supabase = client()
  await saveObservationDraft(input(supabase))
  assert.deepEqual(supabase.operations.map(({ table, action }) => [table, action]), [
    ["pd_observations", "update"], ["pd_observation_sections", "upsert"],
    ["pd_observation_ratings", "upsert"], ["pd_observation_ratings", "delete"],
  ])
  assert.deepEqual(supabase.operations[0].filters, [["id", "observation"], ["status", "draft"], ["observer_id", "writer"]])
  assert.equal("teacher_response" in supabase.operations[1].values[0], false)
  assert.deepEqual(supabase.operations[2].values.map((rating) => rating.criterion_id), [10])
  assert.deepEqual(supabase.operations[3].filters, [["observation_id", "observation"], ["criterion_id", [11]]])
})

test("invalid dates and database failures stop the save and surface an error", async () => {
  const invalid = client()
  const values = input(invalid)
  values.values.observation_date = "2025-01-01"
  await assert.rejects(saveObservationDraft(values), /current academic year/)
  assert.equal(invalid.operations.length, 0)

  const failed = client("pd_observation_sections:upsert")
  await assert.rejects(saveObservationDraft(input(failed)), /Database rejected save/)
  assert.equal(failed.operations.length, 2)
})

test("informal Learning Walk saves only its header", async () => {
  const supabase = client()
  const values = input(supabase)
  values.observation.form_type = "learning_walk"
  await saveObservationDraft(values)
  assert.equal(supabase.operations.length, 1)
  assert.equal(supabase.operations[0].values.overall_rating, null)
})
