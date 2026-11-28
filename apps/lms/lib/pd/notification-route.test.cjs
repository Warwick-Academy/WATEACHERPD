const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

let user = { id: "actor" }
let dispatches = 0
const code = typescript.transpileModule(fs.readFileSync(path.join(__dirname, "..", "..", "app", "api", "pd", "notifications", "dispatch", "route.ts"), "utf8"), {
  compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
new Function("require", "module", "exports", code)((name) => {
  if (name === "@/lib/supabase/server") return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) }
  if (name === "@/lib/pd/notifications") return { dispatchMyNotifications: async () => { dispatches++; return { sent: 1, failures: 0 } } }
  return require(name)
}, mod, mod.exports)

test("dispatch requires same-origin and authenticated requests", async () => {
  const old = process.env.PD_DISPATCH_TOKEN
  process.env.PD_DISPATCH_TOKEN = "test-token"
  try {
    const request = (origin) => new Request("https://pd.example.test/api/pd/notifications/dispatch", { method: "POST", headers: { origin } })
    assert.equal((await mod.exports.POST(request("https://other.example.test"))).status, 403)
    user = null
    assert.equal((await mod.exports.POST(request("https://pd.example.test"))).status, 401)
    assert.equal(dispatches, 0)
    user = { id: "actor" }
    assert.equal((await mod.exports.POST(request("https://pd.example.test"))).status, 200)
    assert.equal(dispatches, 1)
  } finally {
    if (old === undefined) delete process.env.PD_DISPATCH_TOKEN
    else process.env.PD_DISPATCH_TOKEN = old
  }
})
