const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

function compile(file) {
  return typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, jsx: typescript.JsxEmit.ReactJSX },
  }).outputText
}
function loadHelper(name) {
  const mod = { exports: {} }
  new Function("require", "module", "exports", compile(path.join(__dirname, name)))(require, mod, mod.exports)
  return mod.exports
}
const ui = loadHelper("observation-ui.ts")
const draft = loadHelper("observation-draft.ts")
const component = (tag) => ({ children, asChild, ...props }) => React.createElement(tag, props, children)
const components = {
  Badge: component("span"), Button: component("button"), Card: component("div"),
  CardContent: component("div"), CardHeader: component("div"), CardTitle: component("h2"),
  Input: component("input"), Label: component("label"), Textarea: component("textarea"),
}
const mocks = {
  "next/link": { __esModule: true, default: component("a") },
  "next/navigation": { useRouter: () => ({ push() {} }) },
  "@tanstack/react-query": { useMutation: () => ({ isPending: false }), useQueryClient: () => ({ invalidateQueries() {} }) },
  "@/lib/pd/observation-context": {},
  "@/lib/pd/observation-ui": ui,
  "@/lib/pd/observation-draft": draft,
}
const page = path.join(__dirname, "..", "..", "app", "pd", "observations", "[id]", "page.tsx")
const mod = { exports: {} }
new Function("require", "module", "exports", `${compile(page)}\nmodule.exports.testComponents = { ObservationDraft, PublishedObservation, dispatchNotifications }`)(
  (id) => id.startsWith("@/components/ui/") ? components : mocks[id] || require(id), mod, mod.exports,
)
const { ObservationDraft, PublishedObservation, dispatchNotifications } = mod.exports.testComponents

const observation = {
  id: "observation", teacher_id: "teacher", observer_id: "observer", form_type: "appraisal",
  observation_date: "2026-11-27", year_id: 1, status: "draft", year_group: null, subject: null,
  comment: null, overall_comment: null, overall_rating: null, teacher_response: null, goal_id: null,
  teacher_acknowledged_at: null, teacher_signed_at: null, observer_signed_at: null,
}
const detail = {
  observation,
  categories: [{ id: 1, name: "Classroom", is_active: true, student_questions: ["What are you learning?"] }],
  criteria: [
    { id: 1, category_id: 1, label: "Visible prompt", is_active: true, secondary_only: false },
    { id: 2, category_id: 1, label: "Secondary prompt", is_active: true, secondary_only: true },
  ],
  sections: [], ratings: [], goals: [{ id: "goal", title: "My goal" }], comparison: [],
}
const year = { id: 1, start_date: "2026-09-01", end_date: "2027-08-31" }
const teacher = { id: "teacher", name: "Teacher", phase: "primary" }
const observer = { id: "observer", name: "Observer", phase: "secondary" }

test("appraisal draft renders touch-friendly ratings and hides secondary-only criteria for primary staff", () => {
  const html = renderToStaticMarkup(React.createElement(ObservationDraft, {
    detail, teacher, viewer: { ...observer, user_type: "user" }, year, supabase: {},
  }))
  assert.match(html, /Visible prompt/)
  assert.doesNotMatch(html, /Secondary prompt/)
  assert.match(html, /Always\/Mostly/)
  assert.match(html, /Questions to ask students/)
  assert.match(html, /Saved/)
})

test("protected layout mounts the observation form only once for both screen sizes", () => {
  const passthrough = ({ children }) => React.createElement(React.Fragment, null, children)
  const empty = () => null
  const layoutMocks = {
    "next/navigation": { usePathname: () => "/pd/observations/observation" },
    "./Header": { __esModule: true, default: empty },
    "./LeftSidebar": { __esModule: true, default: empty },
    "./MobileMenu": { __esModule: true, default: empty },
    "../utils/client-auth": { useClientAuthState: () => ({}) },
    "./ThemeProvider": { ThemeProvider: passthrough },
    "./PageTransition": { PageTransition: passthrough },
    "@/lib/supabase/client": { isSupabaseConfigured: () => false },
    "@/components/ui/sonner": { Toaster: empty },
    "@/lib/react-query/QueryProvider": { QueryProvider: passthrough },
    "./ErrorBoundary": { ErrorBoundary: passthrough },
    "./DynamicTitle": { __esModule: true, default: empty },
    "./DynamicFavicon": { __esModule: true, default: empty },
    "@tanstack/react-query": { useQueryClient: () => ({}) },
    "@/lib/pd/context-client": { usePdContext: () => ({}) },
  }
  const layoutModule = { exports: {} }
  const layoutFile = path.join(__dirname, "..", "..", "components", "ClientLayout.tsx")
  new Function("require", "module", "exports", compile(layoutFile))(
    (id) => layoutMocks[id] || require(id), layoutModule, layoutModule.exports,
  )
  const html = renderToStaticMarkup(React.createElement(layoutModule.exports.default, null,
    React.createElement("input", { type: "radio", name: "test-rating", value: "yes" }),
  ))
  assert.equal((html.match(/name="test-rating"/g) || []).length, 1)
})

test("published admin view offers reopen but never draft deletion", () => {
  const html = renderToStaticMarkup(React.createElement(PublishedObservation, {
    detail: { ...detail, observation: { ...observation, status: "published" } },
    teacher, observer, viewer: { id: "admin", user_type: "admin" }, year, supabase: {}, onReopen() {},
  }))
  assert.match(html, /Reopen/)
  assert.match(html, /returns this observation to its observer as a private draft/)
  assert.doesNotMatch(html, /Delete draft/)
  assert.doesNotMatch(html, /Link to one of my current-year goals/)
})

test("the observed teacher can select their own current-year goal", () => {
  const html = renderToStaticMarkup(React.createElement(PublishedObservation, {
    detail: { ...detail, observation: { ...observation, status: "published" } },
    teacher, observer, viewer: { ...teacher, user_type: "user" }, year, supabase: {}, onReopen() {},
  }))
  assert.match(html, /Link to one of my current-year goals/)
  assert.match(html, /My goal/)
  assert.match(html, /Save response/)
})

test("publishing self-reflection does not attempt to dispatch an email", async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async () => { calls++; return { ok: true } }
  try {
    await dispatchNotifications("self_reflection")
    assert.equal(calls, 0)
    await dispatchNotifications("learning_walk")
    assert.equal(calls, 1)
  } finally {
    global.fetch = originalFetch
  }
})
