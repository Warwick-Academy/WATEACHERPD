const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const source = fs.readFileSync(path.join(__dirname, "report-utils.ts"), "utf8")
const output = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function("require", "module", "exports", output)(require, mod, mod.exports)
const { readAll, filterTrends, sumHours, summariseTrends, csvText } = mod.exports

test("filtered per-teacher ratings are summed and sorted by concern", () => {
  const row = { year_id: 1, category_order: 1, criterion_order: 1, criterion_id: 2, sometimes: 1, no: 2, always_mostly: 3, na: 0, total: 6 }
  const result = summariseTrends([row, { ...row, teacher_id: "other", sometimes: 4, no: 1 }, { ...row, criterion_id: 3, sometimes: 0, no: 1 }])
  assert.equal(result.length, 2)
  assert.equal(result[0].criterion_id, 2)
  assert.equal(result[0].sometimes, 5)
  assert.equal(result[0].no, 3)
  assert.equal(result[0].total, 12)
  const filtered = filterTrends([{ ...row, department: "Maths", phase: "primary" }, { ...row, department: "Science", phase: "secondary" }], "Maths", "primary")
  assert.equal(summariseTrends(filtered)[0].total, 6)
  assert.equal(filterTrends(filtered, "Maths", "secondary").length, 0)
})

test("CSV has Excel UTF-8 BOM, escaped cells and protects against formulas", () => {
  assert.equal(csvText([["Name", "Text"], ['A, "B"', "=1+1"], ["\tvalue", -2]]), '\uFEFF"Name","Text"\r\n"A, ""B""","\'=1+1"\r\n"\'\tvalue","-2"')
})

test("CPD totals retain two-decimal precision", () => {
  assert.equal(sumHours([{ hours: "0.10" }, { hours: 0.2 }]), 0.3)
})

test("report reads paginate and surface database failures", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => index)
  assert.deepEqual(await readAll(async (from, to) => ({ data: rows.slice(from, to + 1), error: null })), rows)
  await assert.rejects(readAll(async () => ({ data: null, error: { message: "Unavailable" } })), /Unavailable/)
})
