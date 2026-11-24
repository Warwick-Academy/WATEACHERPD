const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const { Readable } = require("node:stream")
const typescript = require("typescript")

function loadFetcher({ addresses = ["8.8.8.8"], responses = [], lookup } = {}) {
  const requests = []
  const request = (options, callback) => {
    requests.push(options)
    const req = new EventEmitter()
    req.end = () => {
      const next = responses.shift()
      if (!next) throw new Error("Unexpected request")
      const response = Readable.from(next.chunks || [])
      response.statusCode = next.status || 200
      response.headers = next.headers || {}
      callback(response)
    }
    return req
  }
  const mocks = {
    "node:dns/promises": { lookup: lookup || (async () => addresses.map((address) => ({ address, family: 4 }))) },
    "node:http": { request },
    "node:https": { request },
  }
  const code = typescript.transpileModule(fs.readFileSync(path.join(__dirname, "fetch.ts"), "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function("require", "module", "exports", code)((id) => mocks[id] || require(id), loadedModule, loadedModule.exports)
  return { ...loadedModule.exports, requests }
}

test("import URL validation rejects local, reserved and unapproved hosts", () => {
  const { validateImportUrl, isPublicAddress } = loadFetcher()
  for (const address of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "192.168.1.1", "192.88.99.1", "::1", "::ffff:127.0.0.1", "fc00::1", "3fff::1"]) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress("8.8.8.8"), true)
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true)
  for (const url of ["http://localhost", "http://127.0.0.1", "http://169.254.169.254", "http://[::1]", "file:///etc/passwd", "https://user:pass@example.com"]) {
    assert.throws(() => validateImportUrl(url, ""), undefined, url)
  }
  assert.equal(validateImportUrl("https://sub.example.com/page", "example.com").hostname, "sub.example.com")
  assert.throws(() => validateImportUrl("https://example.com.attacker.test", "example.com"))
})

test("fetcher pins validated DNS and rejects private DNS answers and redirects", async () => {
  const good = loadFetcher({ responses: [{ chunks: [Buffer.from("content")] }] })
  assert.equal((await good.fetchImportUrl("https://example.com/course")).body, "content")
  assert.equal(good.requests[0].hostname, "8.8.8.8")
  assert.equal(good.requests[0].servername, "example.com")
  assert.equal(good.requests[0].headers.Host, "example.com")

  const privateDns = loadFetcher({ addresses: ["8.8.8.8", "127.0.0.1"] })
  await assert.rejects(privateDns.fetchImportUrl("https://example.com"), /private or reserved/)
  assert.equal(privateDns.requests.length, 0)
  const redirect = loadFetcher({ responses: [{ status: 302, headers: { location: "http://127.0.0.1/" } }] })
  await assert.rejects(redirect.fetchImportUrl("https://example.com"), /Private or reserved/)
  assert.equal(redirect.requests.length, 1)
})

test("fetcher limits redirects and response size", async () => {
  const redirects = loadFetcher({ responses: Array.from({ length: 4 }, () => ({ status: 302, headers: { location: "/next" } })) })
  await assert.rejects(redirects.fetchImportUrl("https://example.com"), /too many redirects/)
  assert.equal(redirects.requests.length, 4)
  const large = loadFetcher({ responses: [{ chunks: [Buffer.alloc(5 * 1024 * 1024 + 1)] }] })
  await assert.rejects(large.fetchImportUrl("https://example.com"), /5 MB/)

  const largeLesson = loadFetcher({ responses: [{ chunks: [Buffer.alloc(5 * 1024 * 1024 + 1)] }] })
  assert.equal((await largeLesson.fetchImportUrl("https://example.com", undefined, {
    maxResponseBytes: 25 * 1024 * 1024,
  })).body.length, 5 * 1024 * 1024 + 1)

  const oversizedLesson = loadFetcher({ responses: [{ chunks: [Buffer.alloc(25 * 1024 * 1024 + 1)] }] })
  await assert.rejects(oversizedLesson.fetchImportUrl("https://example.com", undefined, {
    maxResponseBytes: 25 * 1024 * 1024,
  }), /25 MB/)
})

test("source fetches retain their own deadline and respect caller cancellation", async () => {
  const originalTimeout = AbortSignal.timeout
  const controller = new AbortController()
  let deadline
  AbortSignal.timeout = (milliseconds) => {
    deadline = milliseconds
    return originalTimeout(milliseconds)
  }
  try {
    const fetcher = loadFetcher({ responses: [{ chunks: [Buffer.from("content")] }] })
    await fetcher.fetchImportUrl("https://example.com", controller.signal)
    assert.equal(deadline, 8500)
    assert.notEqual(fetcher.requests[0].signal, controller.signal)
    controller.abort()
    assert.equal(fetcher.requests[0].signal.aborted, true)
  } finally {
    AbortSignal.timeout = originalTimeout
  }
})

test("source timeout retries are bounded, and caller cancellation is not retried", async () => {
  const originalTimeout = AbortSignal.timeout
  let timeouts = 0
  let lookups = 0
  AbortSignal.timeout = () => {
    timeouts++
    const controller = new AbortController()
    if (timeouts === 1) queueMicrotask(() => controller.abort(new DOMException("Timeout", "TimeoutError")))
    return controller.signal
  }
  try {
    const fetcher = loadFetcher({
      lookup: () => {
        lookups++
        return lookups === 1 ? new Promise(() => {}) : Promise.resolve([{ address: "8.8.8.8", family: 4 }])
      },
      responses: [{ chunks: [Buffer.from("content")] }],
    })
    assert.equal((await fetcher.fetchImportUrl("https://example.com")).body, "content")
    assert.equal(timeouts, 2)
    assert.equal(lookups, 2)

    timeouts = 0
    AbortSignal.timeout = () => {
      timeouts++
      const controller = new AbortController()
      queueMicrotask(() => controller.abort(new DOMException("Timeout", "TimeoutError")))
      return controller.signal
    }
    const stalled = loadFetcher({ lookup: () => new Promise(() => {}) })
    await assert.rejects(stalled.fetchImportUrl("https://example.com"), /timed out after 3 attempts/)
    assert.equal(timeouts, 3)

    const cancelled = new AbortController()
    cancelled.abort(new Error("Cancelled by caller"))
    timeouts = 0
    await assert.rejects(stalled.fetchImportUrl("https://example.com", cancelled.signal), /Cancelled by caller/)
    assert.equal(timeouts, 0)
  } finally {
    AbortSignal.timeout = originalTimeout
  }
})
