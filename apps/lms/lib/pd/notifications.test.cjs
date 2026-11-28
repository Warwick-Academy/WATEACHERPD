const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

const originalEnv = { ...process.env }
process.env.SENDGRID_API_KEY = "test-key"
process.env.SENDGRID_FROM_EMAIL = "pd@example.test"
process.env.NEXT_PUBLIC_APP_URL = "https://pd.example.test"
after(() => {
  for (const key of ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL", "NEXT_PUBLIC_APP_URL"]) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

const sent = []
let sendResult = { success: true, messageId: "message-1" }
const compiled = typescript.transpileModule(fs.readFileSync(path.join(__dirname, "notifications.ts"), "utf8"), {
  compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
new Function("require", "module", "exports", compiled)((name) => {
  if (name === "../email/email-service") return { emailService: { sendEmail: async (message) => { sent.push(message); return sendResult } } }
  return require(name)
}, mod, mod.exports)
const { dispatchMyNotifications, runScheduledNotifications } = mod.exports
const id = "31d5e0bb-fc78-4980-a969-1097e27cb101"

function claims(...batches) {
  return () => ({ data: batches.shift() ?? [], error: null })
}

function db(results) {
  const calls = []
  return {
    calls,
    client: { rpc: async (name, args) => {
      calls.push({ name, args })
      const result = results[name]
      return typeof result === "function" ? result() : { data: result ?? null, error: null }
    } },
  }
}

test("immediate dispatch sends an essential notice and records it using the dispatcher token", async () => {
  sent.length = 0
  sendResult = { success: true, messageId: "message-1" }
  const database = db({ pd_claim_my_notifications: claims([{ outbox_id: 1, event_type: "observation_published", observation_id: id, recipient_email: "staff@example.test" }]) })
  assert.deepEqual(await dispatchMyNotifications(database.client, "secret"), { sent: 1, failures: 0 })
  assert.equal(sent[0].data.url, `https://pd.example.test/pd/observations/${id}`)
  assert.equal(database.calls[1].args.p_outcome, "sent")
  assert.equal(database.calls[1].args.p_dispatch_token, "secret")
})

test("failed and uncertain sends are recorded distinctly", async () => {
  for (const [failureKind, expected] of [["definite", "failed"], ["uncertain", "uncertain"]]) {
    sendResult = { success: false, failureKind }
    const database = db({ pd_claim_my_notifications: claims([{ outbox_id: 1, event_type: "teacher_responded", observation_id: id, recipient_email: "staff@example.test" }]) })
    assert.deepEqual(await dispatchMyNotifications(database.client, "secret"), { sent: 0, failures: 1 })
    assert.equal(database.calls[1].args.p_outcome, expected)
  }
})

test("immediate dispatch completes each claim before claiming the next", async () => {
  sent.length = 0
  sendResult = { success: true }
  const database = db({ pd_claim_my_notifications: claims(
    [{ outbox_id: 1, event_type: "appraisal_signed", observation_id: id, recipient_email: "first@example.test" }],
    [{ outbox_id: 2, event_type: "appraisal_signed", observation_id: id, recipient_email: "second@example.test" }],
  ) })
  assert.deepEqual(await dispatchMyNotifications(database.client, "secret"), { sent: 2, failures: 0 })
  assert.deepEqual(database.calls.map((call) => call.name), [
    "pd_claim_my_notifications", "pd_complete_my_notification",
    "pd_claim_my_notifications", "pd_complete_my_notification", "pd_claim_my_notifications",
  ])
})

test("immediate dispatch stops claiming after a completion error or the time budget", async () => {
  sendResult = { success: true }
  const notice = { outbox_id: 1, event_type: "observation_published", observation_id: id, recipient_email: "staff@example.test" }
  const database = db({
    pd_claim_my_notifications: claims([notice], [notice]),
    pd_complete_my_notification: () => ({ data: null, error: { message: "completion failed" } }),
  })
  await assert.rejects(dispatchMyNotifications(database.client, "secret"), /completion failed/)
  assert.equal(database.calls.filter((call) => call.name === "pd_claim_my_notifications").length, 1)

  const limited = db({ pd_claim_my_notifications: claims([notice], [notice]) })
  let tick = 0
  assert.deepEqual(await dispatchMyNotifications(limited.client, "secret", () => tick++ < 2 ? 0 : 10000), { sent: 1, failures: 0 })
  assert.equal(limited.calls.filter((call) => call.name === "pd_claim_my_notifications").length, 1)
})

test("immediate dispatch rejects an incompatible bulk-claim database", async () => {
  const notice = { outbox_id: 1, event_type: "observation_published", observation_id: id, recipient_email: "staff@example.test" }
  const database = db({ pd_claim_my_notifications: claims([notice, { ...notice, outbox_id: 2 }]) })
  await assert.rejects(dispatchMyNotifications(database.client, "secret"), /at most one/)
  assert.equal(database.calls.length, 1)
})

test("scheduled job sends only reminders successfully claimed by the database", async () => {
  sent.length = 0
  sendResult = { success: true }
  const database = db({
    pd_claim_pending_notifications: [],
    pd_list_due_reminders: [{ reminder_type: "goal_due", subject_id: id }, { reminder_type: "observation_unacknowledged", subject_id: id }],
    pd_claim_reminder: (() => { let count = 0; return () => ({ data: ++count === 1 ? [{ log_id: 5, recipient_email: "staff@example.test" }] : [], error: null }) })(),
  })
  assert.deepEqual(await runScheduledNotifications(database.client, () => 0), { notices: 0, reminders: 1 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].data.url, "https://pd.example.test/pd/goals")
  assert.equal(database.calls.find((call) => call.name === "pd_complete_reminder").args.p_outcome, "sent")
})

test("missing configuration prevents claims and database errors are surfaced", async () => {
  const database = db({ pd_claim_my_notifications: () => ({ data: null, error: { message: "denied" } }) })
  delete process.env.SENDGRID_FROM_EMAIL
  await assert.rejects(dispatchMyNotifications(database.client, "secret"), /SENDGRID_FROM_EMAIL/)
  assert.equal(database.calls.length, 0)
  process.env.SENDGRID_FROM_EMAIL = "pd@example.test"
  await assert.rejects(dispatchMyNotifications(database.client, "secret"), /denied/)
})
