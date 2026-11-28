const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

test("PD delivery classifies rejected and unknown outcomes without changing Training's mail client", async () => {
  const originalKey = process.env.SENDGRID_API_KEY
  process.env.SENDGRID_API_KEY = "test-key"
  try {
    let responseError
    let timeout
    const logs = []
    const trainingMailer = { setApiKey() {}, send() { throw new Error("Training mailer should not be used") } }
    class MailService {
      setApiKey() {}
      setTimeout(value) { timeout = value }
      async send() { throw responseError }
    }
    const code = typescript.transpileModule(fs.readFileSync(path.join(__dirname, "..", "email", "email-service.ts"), "utf8"), {
      compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    const mod = { exports: {} }
    new Function("require", "module", "exports", code)((name) => {
      if (name === "@sendgrid/mail") return Object.assign(trainingMailer, { MailService })
      if (name === "./email-templates") return { emailTemplates: { pdNotice: { subject: "Notice", html: () => "html", text: () => "text" } } }
      if (name === "../utils/errorHandler") return { logError: (...args) => logs.push(args), logInfo: (...args) => logs.push(args), logWarning() {} }
      if (name === "../slug") return {}
      return require(name)
    }, mod, mod.exports)
    assert.equal(timeout, 5000)
    for (const [code, expected] of [[400, "definite"], [408, "uncertain"], [500, "uncertain"], ["ECONNRESET", "uncertain"]]) {
      responseError = Object.assign(new Error("delivery error"), { code, config: { headers: { authorization: "secret-token" } } })
      const result = await mod.exports.emailService.sendEmail({ to: "staff@example.test", template: "pdNotice", data: {} })
      assert.equal(result.failureKind, expected)
    }
    assert.doesNotMatch(JSON.stringify(logs), /secret-token|staff@example\.test/)
  } finally {
    if (originalKey === undefined) delete process.env.SENDGRID_API_KEY
    else process.env.SENDGRID_API_KEY = originalKey
  }
})
