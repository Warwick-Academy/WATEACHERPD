const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

const source = fs.readFileSync(path.join(__dirname, "observation-ui.ts"), "utf8")
const output = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS } }).outputText
const mod = { exports: {} }
new Function("require", "module", "exports", output)(require, mod, mod.exports)
const { availableObservationForms, observationPermissions } = mod.exports

test("available forms respect own, assigned and admin choices", () => {
  assert.deepEqual(availableObservationForms("a", "a", "admin", []), ["self_reflection"])
  assert.deepEqual(availableObservationForms("b", "a", "user", []), ["learning_walk"])
  assert.deepEqual(availableObservationForms("f", "a", "user", ["a"]), ["learning_walk", "fl_learning_walk", "appraisal"])
  assert.deepEqual(availableObservationForms("x", "a", "admin", []), ["learning_walk", "fl_learning_walk", "appraisal"])
  assert.deepEqual(availableObservationForms("l", "a", "leadership", []), ["learning_walk"])
})

test("only the writer can edit or delete a draft; admins reopen published records", () => {
  const draft = { observer_id: "b", teacher_id: "a", status: "draft", form_type: "learning_walk" }
  assert.equal(observationPermissions(draft, "b", "user").canDelete, true)
  assert.equal(observationPermissions(draft, "admin", "admin").canEdit, false)
  const published = { ...draft, status: "published" }
  assert.equal(observationPermissions(published, "b", "user").canDelete, false)
  assert.equal(observationPermissions(published, "admin", "admin").canReopen, true)
})

test("appraisal responses and signatures follow each participant's sign-off", () => {
  const appraisal = { observer_id: "f", teacher_id: "a", status: "published", form_type: "appraisal", teacher_signed_at: null, observer_signed_at: null, teacher_acknowledged_at: null }
  assert.equal(observationPermissions(appraisal, "a", "user").canRespond, true)
  assert.equal(observationPermissions(appraisal, "a", "user").canSign, true)
  assert.equal(observationPermissions(appraisal, "f", "user").canSign, true)
  const teacherSigned = { ...appraisal, teacher_signed_at: "2026-11-27" }
  assert.equal(observationPermissions(teacherSigned, "a", "user").canRespond, false)
  assert.equal(observationPermissions(teacherSigned, "a", "user").canSign, false)
  assert.equal(observationPermissions(teacherSigned, "f", "user").canSign, true)
  const signed = { ...teacherSigned, status: "signed", observer_signed_at: "2026-11-27" }
  assert.equal(observationPermissions(signed, "f", "user").canSign, false)
  assert.equal(observationPermissions(signed, "a", "user").canRespond, false)
})

test("published self-reflections do not offer a teacher reply or acknowledgement", () => {
  const item = { observer_id: "a", teacher_id: "a", status: "published", form_type: "self_reflection", teacher_acknowledged_at: null }
  assert.equal(observationPermissions(item, "a", "user").canRespond, false)
  assert.equal(observationPermissions(item, "a", "user").canAcknowledge, false)
})
