const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const { QueryClient, QueryObserver } = require("@tanstack/react-query")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")

test("returning to CPD reloads course completions even when the previous list was cached", async () => {
  let entries = []
  const query = {
    select() { return this }, eq() { return this }, order() { return this },
    async returns() { return { data: entries, error: null } },
  }
  const context = {
    viewer: { id: "staff", user_type: "user" },
    currentYear: { id: 1 }, years: [], people: [], assignments: [], settings: { annual_cpd_target_hours: 40 },
  }
  let activityOptions
  let calls = 0
  const mocks = {
    react: { useMemo: (fn) => fn(), useState: (value) => [value, () => {}] },
    "next/link": { __esModule: true, default: () => null },
    "@tanstack/react-query": {
      useQueryClient: () => ({}), useMutation: () => ({}),
      useQuery: (options) => {
        calls++
        if (calls === 1) return { data: context }
        if (calls === 2) activityOptions = options
        return { data: [] }
      },
    },
    "@/lib/supabase/client": { createClient: () => ({ from: () => query }) },
    "./cpd-editor": { CpdEditor: () => null, activityNames: {} },
  }
  const file = path.join(__dirname, "..", "..", "app", "pd", "cpd", "page.tsx")
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, jsx: typescript.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  new Function("require", "module", "exports", code)((id) => {
    if (id in mocks) return mocks[id]
    if (id.startsWith("@/")) return new Proxy({}, { get: () => () => null })
    return require(id)
  }, mod, mod.exports)
  mod.exports.default()

  const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false, staleTime: 300000, retry: false } } })
  await client.fetchQuery(activityOptions)
  entries = [{ id: "completion", source: "course", hours: 1 }]
  const observer = new QueryObserver(client, activityOptions)
  let resolveFetch
  const fetched = new Promise((resolve) => { resolveFetch = resolve })
  const unsubscribe = observer.subscribe((result) => {
    if (result.isFetchedAfterMount && result.data?.length) resolveFetch(result.data)
  })

  try {
    assert.deepEqual(await fetched, entries)
  } finally {
    unsubscribe()
    client.clear()
  }
})

test("in-progress training is separate from credited hours and limited to the viewer", async () => {
    const rows = [
      { id: "active", user_id: "staff", status: "active", progress: 25, courses: { id: 1, title: "Active course" } },
      { id: "done", user_id: "staff", status: "completed", progress: 100, courses: { id: 2, title: "Completed course" } },
      { id: "cancelled", user_id: "staff", status: "cancelled", progress: 0, courses: { id: 3, title: "Cancelled course" } },
      { id: "other", user_id: "other", status: "active", progress: 0, courses: { id: 4, title: "Another person's course" } },
    ]
    const supabase = { from(table) {
      assert.equal(table, "enrollments")
      let filtered = rows
      return {
        select() { return this }, order() { return this }, range() { return this },
        eq(key, value) { filtered = filtered.filter((row) => row[key] === value); return this },
        async returns() { return { data: filtered, error: null } },
      }
    } }
    const context = {
      viewer: { id: "staff", user_type: "admin" }, currentYear: { id: 1 }, years: [],
      people: [], assignments: [], settings: { annual_cpd_target_hours: 40 },
    }
    let queryIndex = 0
    let stateIndex = 0
    let selectedPerson = ""
    let inProgressOptions
    let inProgressResult = { data: [] }
    const component = ({ children }) => React.createElement("div", null, children)
    const mocks = {
      react: {
        useMemo: (fn) => fn(),
        useState: (value) => [stateIndex++ === 1 ? selectedPerson : value, () => {}],
      },
      "next/link": { __esModule: true, default: ({ children, href }) => React.createElement("a", { href }, children) },
      "@tanstack/react-query": {
        useQueryClient: () => ({}), useMutation: () => ({}),
        useQuery: (options) => {
          const index = queryIndex++
          if (index === 0) return { data: context }
          if (index === 1) return { data: [{ hours: 2, source: "manual", title: "Credited", id: "cpd" }] }
          if (index === 4) { inProgressOptions = options; return inProgressResult }
          return { data: [] }
        },
      },
      "@/lib/supabase/client": { createClient: () => supabase },
      "@/lib/slug": { createCourseSlug: (_, id) => `course-${id}` },
      "@/lib/pd/report-utils": { readAll: async (page) => {
        const { data, error } = await page(0, 999)
        if (error) throw new Error(error.message)
        return data
      } },
      "./cpd-editor": { CpdEditor: component, activityNames: {} },
    }
    const file = path.join(__dirname, "..", "..", "app", "pd", "cpd", "page.tsx")
    const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: typescript.ModuleKind.CommonJS, jsx: typescript.JsxEmit.ReactJSX },
    }).outputText
    const mod = { exports: {} }
    new Function("require", "module", "exports", code)((id) => {
      if (id in mocks) return mocks[id]
      if (id.startsWith("@/")) return new Proxy({}, { get: () => component })
      return require(id)
    }, mod, mod.exports)
    function render() {
      queryIndex = 0
      stateIndex = 0
      return renderToStaticMarkup(mod.exports.default())
    }
    render()
    inProgressResult = { data: await inProgressOptions.queryFn() }
    const html = render()
    assert.match(html, /Active course/)
    assert.match(html, /25% complete/)
    assert.match(html, /2 of 40 hours/)
    assert.doesNotMatch(html, /Completed course|Cancelled course|Another person&#x27;s course/)
    selectedPerson = "other"
    assert.doesNotMatch(render(), /In-progress Training Courses/)
    assert.equal(inProgressOptions.enabled, false)
    selectedPerson = ""
    inProgressResult = { error: new Error("Unable to load enrolments") }
    assert.match(render(), /Unable to load enrolments/)
})
