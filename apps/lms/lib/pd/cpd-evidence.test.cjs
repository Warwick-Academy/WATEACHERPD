const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const output = typescript.transpileModule(fs.readFileSync(path.join(__dirname, "cpd-evidence.ts"), "utf8"), {
  compilerOptions: { module: typescript.ModuleKind.CommonJS },
}).outputText
const mod = { exports: {} }
new Function("require", "module", "exports", output)(require, mod, mod.exports)
const { evidenceFileInfo, removeUnusedEvidence } = mod.exports

test("evidence permits only supported formats up to 10 MB", () => {
  assert.equal(evidenceFileInfo({ name: "lesson.pdf", type: "application/pdf", size: 10 * 1024 * 1024 }).mimeType, "application/pdf")
  assert.equal(evidenceFileInfo({ name: "report.docx", type: "", size: 1 }).mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  assert.throws(() => evidenceFileInfo({ name: "x.exe", type: "", size: 1 }), /PDF, PNG, JPG or DOCX/)
  assert.throws(() => evidenceFileInfo({ name: "x.pdf", type: "image/png", size: 1 }), /PDF, PNG, JPG or DOCX/)
  assert.throws(() => evidenceFileInfo({ name: "x.pdf", type: "application/pdf", size: 0 }), /non-empty/)
  assert.throws(() => evidenceFileInfo({ name: "x.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1 }), /10 MB/)
  assert.equal(evidenceFileInfo({ name: "../../x.pdf", type: "application/pdf", size: 1 }).filename.includes("/"), false)
})

test("evidence removal retains files still referenced and reports storage errors", async () => {
  let referenced = true
  let removed = 0
  const supabase = {
    from: () => ({ select() { return this }, eq() { return this }, limit: async () => ({ data: referenced ? [{ id: "other" }] : [], error: null }) }),
    storage: { from: () => ({ remove: async () => { removed++; return { error: { message: "Storage unavailable" } } } }) },
  }
  await removeUnusedEvidence(supabase, "owner/file")
  assert.equal(removed, 0)
  referenced = false
  await assert.rejects(removeUnusedEvidence(supabase, "owner/file"), /Storage unavailable/)
})
