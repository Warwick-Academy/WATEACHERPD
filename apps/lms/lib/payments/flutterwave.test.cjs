const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

test("transaction verification supplies the public and secret keys in SDK order", async () => {
  const originalPublicKey = process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY
  const originalSecretKey = process.env.FLUTTERWAVE_SECRET_KEY
  process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY = "test-public-key"
  process.env.FLUTTERWAVE_SECRET_KEY = "test-secret-key"
  try {
    let constructorArgs
    let verificationArgs
    class MockFlutterwave {
      constructor(...args) {
        constructorArgs = args
        this.Transaction = { verify: async (data) => { verificationArgs = data; return { status: "success" } } }
      }
    }
    const code = typescript.transpileModule(fs.readFileSync(path.join(__dirname, "flutterwave.ts"), "utf8"), {
      compilerOptions: { module: typescript.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    new Function("require", "module", "exports", code)(
      (id) => id === "flutterwave-node-v3" ? MockFlutterwave : require(id), module, module.exports
    )
    assert.deepEqual(await module.exports.verifyTransaction("transaction-1"), { status: "success" })
    assert.deepEqual(constructorArgs, ["test-public-key", "test-secret-key"])
    assert.deepEqual(verificationArgs, { id: "transaction-1" })
  } finally {
    if (originalPublicKey === undefined) delete process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY
    else process.env.NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY = originalPublicKey
    if (originalSecretKey === undefined) delete process.env.FLUTTERWAVE_SECRET_KEY
    else process.env.FLUTTERWAVE_SECRET_KEY = originalSecretKey
  }
})
