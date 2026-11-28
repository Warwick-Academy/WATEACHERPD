const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")
const { QueryClient, QueryObserver } = require("@tanstack/react-query")

function compile(file) {
  return typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, jsx: typescript.JsxEmit.ReactJSX },
  }).outputText
}
function load(file, mocks, extra = "") {
  const mod = { exports: {} }
  new Function("require", "module", "exports", `${compile(file)}\n${extra}`)((id) => id in mocks ? mocks[id] : require(id), mod, mod.exports)
  return mod.exports
}
const ui = load(path.join(__dirname, "observation-ui.ts"), {})
const draft = load(path.join(__dirname, "observation-draft.ts"), {})
const root = path.join(__dirname, "..", "..", "app", "pd", "observations")

function setup(realClient, onDelete = () => {}, dirty = false) {
  const calls = []
  const stateChanges = []
  let mutation
  let stateIndex = 0
  let refIndex = 0
  const viewer = { id: "writer", user_type: "admin" }
  const queryClient = { invalidateQueries: async (options) => {
    calls.push(["invalidate", options.queryKey])
    if (realClient) await realClient.invalidateQueries(options)
  } }
  const form = {
    register: () => ({}), watch: () => "", setValue() {}, getValues: () => ({}),
    formState: { errors: {} }, handleSubmit: () => () => {},
  }
  const hooks = {
    useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect() {},
    useRef: (value) => ({ current: dirty && refIndex++ === 0 ? 1 : value }),
    useState: (value) => { const index = stateIndex++; return [value, (next) => stateChanges.push([index, next])] },
  }
  const result = { error: null, data: { id: "draft-id" } }
  const query = { delete() { return this }, eq() { return this }, select() { return this }, single: async () => { onDelete(); return result } }
  const mocks = {
    react: hooks,
    "next/link": { __esModule: true, default: "a" },
    "next/navigation": { useRouter: () => ({ push: (url) => calls.push(["push", url]) }) },
    "react-hook-form": { useForm: () => form },
    "@hookform/resolvers/zod": { zodResolver: () => () => {} },
    "@tanstack/react-query": { useQueryClient: () => queryClient, useMutation: (options) => { mutation = options; return {} } },
    "@/lib/pd/observation-context": { useObservationContext: () => ({ supabase: {}, context: { data: { viewer, people: [], ledStaffIds: [], year: { start_date: "2026-09-01", end_date: "2027-08-31" } } } }) },
    "@/lib/pd/observation-ui": ui,
    "@/lib/pd/observation-draft": draft,
    sonner: { toast: { success: (message) => calls.push(["success", message]) } },
  }
  for (const component of ["badge", "button", "card", "input", "label", "textarea"]) {
    mocks[`@/components/ui/${component}`] = { Badge: "span", Button: "button", Card: "div", CardContent: "div", CardHeader: "div", CardTitle: "div", Input: "input", Label: "label", Textarea: "textarea" }
  }
  return { calls, stateChanges, viewer, mocks, supabase: { from: () => query }, getMutation: () => mutation }
}

function findButton(element, label) {
  if (!element || typeof element !== "object") return undefined
  if (element.type === "button" && element.props.children === label) return element
  const children = element.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findButton(child, label)
    if (found) return found
  }
}

function findComponent(element, name) {
  if (!element || typeof element !== "object") return undefined
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findComponent(child, name)
      if (found) return found
    }
    return undefined
  }
  if (typeof element.type === "function" && element.type.name === name) return element
  const children = element.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findComponent(child, name)
    if (found) return found
  }
}

test("reopening a saved draft waits for fresh detail rather than editing cached fields", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false, staleTime: 300000, retry: false } } })
  const env = setup()
  let stored = { id: "draft-id", status: "draft", form_type: "learning_walk", teacher_id: "teacher", observation_date: "2026-11-28", year_group: null, subject: null, comment: null }
  const supabase = { from(table) {
    let update
    const query = {
      select() { return query }, eq() { return query }, order() { return query },
      update(values) { update = values; return query },
      async single() { stored = { ...stored, ...update }; return { data: { id: stored.id }, error: null } },
      async maybeSingle() { return { data: { ...stored }, error: null } },
      async returns() { return { data: table === "pd_observations" ? [{ ...stored }] : [], error: null } },
    }
    return query
  } }
  const context = { data: { viewer: env.viewer, people: [], year: { id: 1, start_date: "2026-09-01", end_date: "2027-08-31" } } }
  env.mocks.react.use = (value) => value
  env.mocks["@/lib/pd/observation-context"].useObservationContext = () => ({ supabase, context })
  let options
  let result = { data: undefined, isFetchedAfterMount: false, error: null }
  env.mocks["@tanstack/react-query"].useQuery = (value) => { options = value; return result }
  const page = load(path.join(root, "[id]", "page.tsx"), env.mocks)
  const render = () => page.default({ params: { id: "draft-id" } })
  render()
  await client.fetchQuery(options)
  await draft.saveObservationDraft({
    supabase, observation: stored, viewerId: env.viewer.id, year: context.data.year, categories: [], criteria: [],
    values: { observation_date: "2026-11-28", year_group: "11", subject: "Computing", comment: "Editing draft", overall_comment: "", overall_rating: "", sections: {}, ratings: {} },
  })

  const observer = new QueryObserver(client, options)
  result = observer.getCurrentResult()
  assert.equal(result.data.observation.subject, null)
  assert.equal(findComponent(render(), "ObservationDraft"), undefined)
  let resolveFetch
  const fetched = new Promise((resolve) => { resolveFetch = resolve })
  const unsubscribe = observer.subscribe((next) => {
    result = next
    if (next.isFetchedAfterMount) resolveFetch()
  })
  try {
    await fetched
    const editor = findComponent(render(), "ObservationDraft")
    assert.equal(editor.props.detail.observation.year_group, "11")
    assert.equal(editor.props.detail.observation.subject, "Computing")
    assert.equal(editor.props.detail.observation.comment, "Editing draft")
    result = { ...result, error: new Error("Could not load observation") }
    assert.equal(findComponent(render(), "ObservationDraft"), undefined)
  } finally {
    unsubscribe()
    client.clear()
  }
})

test("creating a draft invalidates the cached observations list before navigation", async () => {
  const env = setup()
  const page = load(path.join(root, "new", "page.tsx"), env.mocks)
  page.default()
  await env.getMutation().onSuccess("draft-id")
  assert.deepEqual(env.calls, [
    ["invalidate", ["pd", "observations", "writer"]],
    ["push", "/pd/observations/draft-id"],
  ])
})

test("deletion refreshes an inactive list despite refetchOnMount being disabled", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { refetchOnMount: false, retry: false } } })
  const key = ["pd", "observations", "writer"]
  let records = [{ id: "draft-id" }]
  await client.fetchQuery({ queryKey: key, queryFn: async () => records })
  const env = setup(client, () => { records = [] })
  const page = load(path.join(root, "[id]", "page.tsx"), env.mocks, "module.exports.ObservationDraft = ObservationDraft")
  const element = page.ObservationDraft({
    detail: { observation: { id: "draft-id", form_type: "learning_walk", observation_date: "2026-11-28" }, categories: [], criteria: [], sections: [], ratings: [] },
    viewer: env.viewer, year: { id: 1 }, supabase: env.supabase,
  })

  const originalWindow = global.window
  global.window = { confirm: () => true }
  try {
    findButton(element, "Delete draft").props.onClick()
    for (let i = 0; i < 50 && !env.calls.some((call) => call[0] === "push"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.deepEqual(client.getQueryData(key), [])
    assert.deepEqual(env.calls, [
      ["invalidate", ["pd", "observations", "writer"]],
      ["push", "/pd/observations"],
    ])
  } finally {
    global.window = originalWindow
    client.clear()
  }
})

test("saving a draft confirms success before returning to observations", async () => {
  const env = setup()
  const page = load(path.join(root, "[id]", "page.tsx"), env.mocks, "module.exports.ObservationDraft = ObservationDraft")
  const element = page.ObservationDraft({
    detail: { observation: { id: "draft-id", form_type: "learning_walk", observation_date: "2026-11-28" }, categories: [], criteria: [], sections: [], ratings: [] },
    viewer: env.viewer, year: { id: 1 }, supabase: env.supabase,
  })
  findButton(element, "Save draft").props.onClick()
  for (let i = 0; i < 100 && !env.calls.some((call) => call[0] === "push"); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.deepEqual(env.calls, [
    ["invalidate", ["pd", "observations", "writer"]],
    ["success", "Draft saved."],
    ["push", "/pd/observations?tab=written"],
  ])
})

test("an invalid draft stays open and shows an error when saving", async () => {
  const env = setup(undefined, undefined, true)
  const page = load(path.join(root, "[id]", "page.tsx"), env.mocks, "module.exports.ObservationDraft = ObservationDraft")
  const element = page.ObservationDraft({
    detail: { observation: { id: "draft-id", form_type: "learning_walk", observation_date: "2026-11-28" }, categories: [], criteria: [], sections: [], ratings: [] },
    viewer: env.viewer, year: { id: 1 }, supabase: env.supabase,
  })
  findButton(element, "Save draft").props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(env.stateChanges.some(([index, value]) => index === 1 && /Check the date/.test(value)))
  assert.deepEqual(env.calls, [])
})

test("the observations list selects Written by me when returning from save", () => {
  const env = setup()
  env.mocks.react.useEffect = (effect) => effect()
  env.mocks["@tanstack/react-query"].useQuery = () => ({ data: [], isPending: false })
  const originalWindow = global.window
  global.window = { location: { search: "?tab=written" } }
  try {
    load(path.join(root, "page.tsx"), env.mocks).default()
    assert.ok(env.stateChanges.some(([index, value]) => index === 0 && value === "written"))
  } finally {
    global.window = originalWindow
  }
})
