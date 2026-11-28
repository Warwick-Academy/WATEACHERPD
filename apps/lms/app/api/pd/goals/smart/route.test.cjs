const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

function loadRoute({ user = { id: "staff-id" }, model = "model", generate = async () => ({ object: {} }) } = {}) {
  const mocks = {
    ai: { generateObject: generate },
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/ai/quiz-model": { getQuizModel: () => model },
    "@/lib/supabase/server": {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
    },
    "@/lib/utils/errorHandler": { logError: () => {} },
  }
  const output = typescript.transpileModule(fs.readFileSync(path.join(__dirname, "route.ts"), "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function("require", "module", "exports", output)((id) => mocks[id] ?? require(id), mod, mod.exports)
  return mod.exports.POST
}

test("SMART feedback requires authentication and rejects extra personal fields", async () => {
  const body = { goal: "Improve my assessment practice.", name: "Do not send" }
  const request = { json: async () => body }
  assert.equal((await loadRoute({ user: null })(request)).status, 401)
  assert.equal((await loadRoute()(request)).status, 400)
})

test("SMART feedback sends only the supplied goal description", async () => {
  let submitted
  const suggestions = { specific: "Clarify the action", measurable: "Add a measure", achievable: "Set a realistic scope", relevant: "Explain the relevance", time_bound: "Add a date" }
  const route = loadRoute({ generate: async (input) => { submitted = input; return { object: suggestions } } })
  const response = await route({ json: async () => ({ goal: "Improve my assessment practice." }) })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.suggestions, suggestions)
  assert.equal(submitted.prompt, "Improve my assessment practice.")
  assert.equal(JSON.stringify(submitted).includes("staff-id"), false)
})
