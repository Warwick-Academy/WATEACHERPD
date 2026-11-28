const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

const source = fs.readFileSync(path.join(__dirname, "goal-permissions.ts"), "utf8")
const output = typescript.transpileModule(source, {
  compilerOptions: { module: typescript.ModuleKind.CommonJS },
}).outputText
const mod = { exports: {} }
new Function("require", "module", "exports", output)(require, mod, mod.exports)
const { getGoalPermissions } = mod.exports

test("staff own current goals; leaders may comment but not edit", () => {
  assert.deepEqual(getGoalPermissions({ role: "user", isCurrentYear: true, isOwner: true, isLeader: false }), { canEdit: true, canUpdate: true })
  assert.deepEqual(getGoalPermissions({ role: "user", isCurrentYear: true, isOwner: false, isLeader: true }), { canEdit: false, canUpdate: true })
  assert.deepEqual(getGoalPermissions({ role: "user", isCurrentYear: true, isOwner: false, isLeader: false }), { canEdit: false, canUpdate: false })
})

test("historical goals are read-only except for admins", () => {
  assert.deepEqual(getGoalPermissions({ role: "user", isCurrentYear: false, isOwner: true, isLeader: true }), { canEdit: false, canUpdate: false })
  assert.deepEqual(getGoalPermissions({ role: "admin", isCurrentYear: false, isOwner: false, isLeader: false }), { canEdit: true, canUpdate: true })
})

test("leadership can manage their own current goals but not other staff goals", () => {
  assert.deepEqual(getGoalPermissions({ role: "leadership", isCurrentYear: true, isOwner: true, isLeader: false }), { canEdit: true, canUpdate: true })
  assert.deepEqual(getGoalPermissions({ role: "leadership", isCurrentYear: true, isOwner: false, isLeader: true }), { canEdit: false, canUpdate: false })
  assert.deepEqual(getGoalPermissions({ role: "leadership", isCurrentYear: false, isOwner: true, isLeader: false }), { canEdit: false, canUpdate: false })
})
