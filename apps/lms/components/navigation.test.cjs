const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

test("desktop and mobile navigation omit purchase links for every role", () => {
  const component = () => null
  const Link = () => null
  const ui = new Proxy({}, { get: () => component })
  const element = (type, props) => ({ type, props: props || {} })
  let stateCall = 0
  const mocks = {
    react: { useState: (initial) => [stateCall++ === 1 ? true : initial, () => {}], useEffect: () => {} },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: component },
    "next/navigation": { usePathname: () => "/" },
    "next/link": { default: Link },
    "lucide-react": ui,
    "@/components/ui/button": ui,
    "@/components/ui/sheet": ui,
    "@/components/ui/avatar": ui,
    "@/components/ui/skeleton": ui,
    "./Logo": { default: component },
    "./ThemeToggle": ui,
    "./CopyrightText": { default: component },
    "./Indicator": { default: component },
    "../utils/logout": { logout: () => {} },
  }
  const load = (name) => {
    const code = typescript.transpileModule(fs.readFileSync(path.join(__dirname, `${name}.tsx`), "utf8"), {
      compilerOptions: { module: typescript.ModuleKind.CommonJS, jsx: typescript.JsxEmit.ReactJSX },
    }).outputText
    const module = { exports: {} }
    new Function("require", "module", "exports", code)((id) => mocks[id], module, module.exports)
    return module.exports.default
  }
  const nodes = (root) => {
    if (Array.isArray(root)) return root.flatMap(nodes)
    if (!root || typeof root !== "object") return []
    return [root, ...nodes(root.props?.children)]
  }
  for (const name of ["LeftSidebar", "MobileMenu"]) {
    const Menu = load(name)
    for (const userType of ["user", "admin", "instructor"]) {
      stateCall = 0
      const links = nodes(Menu({ userType, user: { name: "User", profileImage: "" } }))
        .filter((node) => node.type === Link).map((node) => node.props.href)
      assert.ok(links.includes(userType === "user" ? "/learner/courses" : "/admin/courses"))
      assert.ok(!links.includes("/learner/purchase"))
      assert.ok(!links.includes("/admin/purchases"))
    }
  }
})
