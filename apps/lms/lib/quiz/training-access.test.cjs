const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

const root = path.join(__dirname, "..", "..", "app", "learner", "courses")
const pages = [
  path.join(root, "page.tsx"),
  path.join(root, "[id]", "learn", "summary", "page.tsx"),
]

function authRedirect(file, auth) {
  const effects = []
  const redirects = []
  const hooks = {
    useState: (value) => [value, () => {}],
    useEffect: (effect) => effects.push(effect),
    useMemo: (fn) => fn(),
  }
  const dataHooks = new Proxy({}, { get: (_, name) => name.startsWith("useRealtime") ? () => {} : () => ({}) })
  const mocks = {
    react: hooks,
    "next/navigation": { useRouter: () => ({ push: (url) => redirects.push(url) }), useParams: () => ({ id: "1" }) },
    "@/utils/client-auth": { useClientAuthState: () => auth },
    "@/lib/react-query/hooks": dataHooks,
    "@/lib/react-query/hooks/useSkeleton": { usePageSkeleton: () => true },
    "@/lib/slug": { extractIdFromSlug: () => "1", createCourseSlug: () => "course-1" },
    sonner: { toast: {} },
  }
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, jsx: typescript.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} }
  new Function("require", "module", "exports", code)((id) => {
    if (id in mocks) return mocks[id]
    if (id.startsWith("@/") || id === "lucide-react") return new Proxy({}, { get: () => () => null })
    return require(id)
  }, mod, mod.exports)
  mod.exports.default()
  effects[1]()
  return redirects
}

for (const file of pages) {
  test(`${path.relative(root, file)} allows signed-in staff roles and redirects signed-out visitors`, () => {
    for (const userType of ["user", "admin", "leadership", "instructor"]) {
      assert.deepEqual(authRedirect(file, { user: { id: "staff" }, userType, loading: false }), [])
    }
    assert.deepEqual(authRedirect(file, { user: null, loading: false }), ["/auth/learner/login"])
    assert.deepEqual(authRedirect(file, { user: null, loading: true }), [])
  })
}
