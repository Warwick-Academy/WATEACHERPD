const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co"

function loadTypeScript(file, mocks) {
  const code = typescript.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  new Function("require", "module", "exports", code)((id) => id in mocks ? mocks[id] : require(id), module, module.exports)
  return module.exports
}

const shared = loadTypeScript(path.join(__dirname, "shared.ts"), {})

test("certificate uses a light blue default background without replacing custom templates", async () => {
  const PDFDocument = require("pdfkit")
  const sharp = require("sharp")
  const { renderCertificate } = loadTypeScript(path.join(__dirname, "..", "certificates", "certificate-renderer.ts"), {})
  const data = {
    title: "Certificate of Completion",
    studentName: "Learner",
    courseName: "Course",
    descriptionTemplate: "This certifies that [Student Name] completed [Course Name].",
    issuedOn: "November 22, 2026",
    certificateNumber: "CERT-1",
  }
  const render = (template) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape" })
    const fills = []
    const fill = doc.fill
    doc.fill = function (color, ...args) {
      fills.push(color)
      return fill.call(this, color, ...args)
    }
    renderCertificate(doc, data, { template }, { regular: "Helvetica", bold: "Helvetica-Bold" })
    doc.end()
    return fills
  }

  assert.ok(render(null).includes("#E6F4FA"))
  const template = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#ffffff" } }).png().toBuffer()
  assert.ok(!render(template).includes("#E6F4FA"))
  assert.ok(render(Buffer.from("invalid image")).includes("#E6F4FA"))
})

function certificateDownloadFixture(options = {}) {
  const certificate = {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "owner",
    course_id: 1,
    certificate_number: "CERT-1",
    issued_at: "2026-01-01",
    certificate_url: "old/certificate.pdf",
    courses: { id: 1, title: "Course", certificate_enabled: true, ...options.course },
    profiles: { name: "Learner" },
  }
  const files = new Map([[certificate.certificate_url, Buffer.from("old PDF")]])
  const generated = []
  const calls = []
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: options.user || "owner" } } }) },
    from(table) {
      let update
      return {
        select() { return this },
        eq() { return this },
        limit() { return this },
        update(value) { update = value; return this },
        async maybeSingle() {
          return { data: table === "certificates" ? certificate : {}, error: null }
        },
        async single() { return { data: { user_type: options.role || "user" }, error: null } },
        then(resolve) {
          Object.assign(certificate, update)
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
    },
  }
  const { GET } = loadTypeScript(path.join(__dirname, "..", "..", "app", "api", "certificates", "[id]", "download", "route.ts"), {
    "next/server": require("next/server"),
    "@/lib/supabase/server": { createClient: async () => client, createServiceRoleClient: () => client },
    "@/lib/certificates/generate-pdf": { generateCertificatePDF: async (data) => {
      generated.push(data)
      if (options.generationError) throw new Error("generation failed")
      return Buffer.from("new PDF")
    } },
    "@/lib/certificates/course-grade": { getCourseGradeAndHours: async () => ({}) },
    "@/lib/storage/shared": shared,
    "@/lib/storage/server": {
      uploadFile: async (buffer, key) => {
        calls.push(["upload", key])
        if (options.uploadError) throw new Error("upload failed")
        files.set(key, buffer)
      },
      downloadFile: async (key) => { calls.push(["download", key]); return files.get(key) },
    },
    "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {} },
    "@/lib/supabase/brand-settings": { getBrandSettings: async () => ({}) },
  })
  return {
    certificate, files, generated, calls,
    download: () => GET(new Request("http://localhost"), { params: Promise.resolve({ id: certificate.id }) }),
  }
}

test("certificate download regenerates legacy PDFs once and keeps the original", async () => {
  const fixture = certificateDownloadFixture({ course: { certificate_enabled: false, certificate_template: "custom-template.png" } })
  const first = await fixture.download()
  assert.equal(first.status, 200)
  assert.equal(first.headers.get("cache-control"), "private, no-store")
  assert.equal(await first.text(), "new PDF")
  assert.equal(fixture.generated[0].certificateTemplate, "custom-template.png")
  assert.match(fixture.certificate.certificate_url, /-light-blue-v1\.pdf$/)
  assert.notEqual(fixture.certificate.certificate_url, "old/certificate.pdf")
  assert.equal(fixture.files.get("old/certificate.pdf").toString(), "old PDF")
  const second = await fixture.download()
  assert.equal(await second.text(), "new PDF")
  assert.equal(fixture.generated.length, 1)
  assert.deepEqual(fixture.calls.map(([operation]) => operation), ["upload", "download"])
})

test("certificate authorization precedes storage access and PDF generation", async () => {
  const fixture = certificateDownloadFixture({ user: "other" })
  assert.equal((await fixture.download()).status, 403)
  assert.deepEqual(fixture.calls, [])
  assert.deepEqual(fixture.generated, [])
})

test("certificate regeneration failures leave the original PDF and pointer intact", async () => {
  for (const option of ["generationError", "uploadError"]) {
    const fixture = certificateDownloadFixture({ [option]: true })
    const response = await fixture.download()
    assert.equal(response.status, option === "generationError" ? 500 : 200)
    assert.equal(fixture.certificate.certificate_url, "old/certificate.pdf")
    assert.equal(fixture.files.get("old/certificate.pdf").toString(), "old PDF")
  }
})

function mockAuthMocks(role) {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "caller" } } }) },
    from: () => ({
      select() { return this },
      eq() { return this },
      single: async () => ({ data: { user_type: role }, error: null }),
    }),
  }
  const uploads = []
  return {
    uploads,
    mocks: {
      "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
      "@/lib/supabase/server": { createClient: async () => client, createServiceRoleClient: () => client },
      "@/lib/utils/errorHandler": { logError() {}, logWarning() {}, logInfo() {} },
      "@/lib/storage/shared": shared,
      "@/lib/storage/server": {
        createSignedUploadUrl: async (p) => ({ signedUrl: `https://signed.example/${p}`, token: "token", path: p }),
        deleteFile: async (p) => { uploads.push(p) },
      },
    },
  }
}

test("URL-to-path only matches this project's storage and never site or external files", () => {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  const inside = shared.extractStoragePathFromUrl(`${supabase}/storage/v1/object/public/public-media/courses/course-1/thumbnail-1-a%20b.png`)
  assert.deepEqual(inside, { bucket: "public-media", path: "courses/course-1/thumbnail-1-a b.png" })
  assert.equal(shared.extractStoragePathFromUrl("/courses/excel-foundations-thumbnail.png"), null)
  assert.equal(shared.extractStoragePathFromUrl("/brand/logo-black.png"), null)
  assert.equal(shared.extractStoragePathFromUrl("https://wateacherpd.netlify.app/brand/signature.png"), null)
  assert.equal(shared.extractStoragePathFromUrl(`${supabase}/storage/v1/object/public/other-bucket/file.png`), null)
  assert.equal(shared.extractStoragePathFromUrl(""), null)
})

test("signed upload URLs enforce roles, types and size limits", async () => {
  const route = (role) => loadTypeScript(
    path.join(__dirname, "..", "..", "app", "api", "upload", "signed-url", "route.ts"),
    mockAuthMocks(role).mocks
  )
  const request = (body) => ({ json: async () => body })
  const adminRoute = route("admin")

  const ok = await adminRoute.POST(request({ filename: "intro.mp4", fileType: "video", contentType: "video/mp4", fileSize: 10 * 1024 * 1024, courseId: 7 }))
  assert.equal(ok.status, 200)
  assert.match(ok.body.path, /^courses\/course-7\/preview-video-/)
  assert.equal(ok.body.bucket, "public-media")
  assert.match(ok.body.url, /\/storage\/v1\/object\/public\/public-media\//)

  const tooLarge = await adminRoute.POST(request({ filename: "big.mp4", fileType: "video", contentType: "video/mp4", fileSize: 51 * 1024 * 1024 }))
  assert.equal(tooLarge.status, 400)
  assert.match(tooLarge.body.error, /YouTube/)

  const wrongType = await adminRoute.POST(request({ filename: "virus.exe", fileType: "video", contentType: "application/octet-stream", fileSize: 100 }))
  assert.equal(wrongType.status, 400)

  const userRoute = route("user")
  const forbidden = await userRoute.POST(request({ filename: "a.png", fileType: "thumbnail", contentType: "image/png", fileSize: 100 }))
  assert.equal(forbidden.status, 403)

  const avatar = await userRoute.POST(request({ filename: "me.png", fileType: "avatar", contentType: "image/png", fileSize: 100 }))
  assert.equal(avatar.status, 200)
  assert.match(avatar.body.path, /^profile\/user-caller\/avatar-/)
})

test("delete route ignores non-storage URLs and restricts users to their own profile files", async () => {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  const file = path.join(__dirname, "..", "..", "app", "api", "upload", "delete", "route.ts")
  const request = (body) => ({ json: async () => body })

  const admin = mockAuthMocks("admin")
  const adminRoute = loadTypeScript(file, admin.mocks)
  const noop = await adminRoute.POST(request({ url: "https://wateacherpd.netlify.app/brand/signature.png" }))
  assert.equal(noop.status, 200)
  assert.match(noop.body.message, /nothing to delete/)
  assert.deepEqual(admin.uploads, [])

  const deleted = await adminRoute.POST(request({ url: `${supabase}/storage/v1/object/public/public-media/courses/course-1/thumbnail-1-a.png` }))
  assert.equal(deleted.status, 200)
  assert.deepEqual(admin.uploads, ["courses/course-1/thumbnail-1-a.png"])

  const user = mockAuthMocks("user")
  const userRoute = loadTypeScript(file, user.mocks)
  const forbidden = await userRoute.POST(request({ url: `${supabase}/storage/v1/object/public/public-media/courses/course-1/thumbnail-1-a.png` }))
  assert.equal(forbidden.status, 403)
  assert.deepEqual(user.uploads, [])

  const own = await userRoute.POST(request({ url: `${supabase}/storage/v1/object/public/public-media/profile/user-caller/avatar-1-me.png` }))
  assert.equal(own.status, 200)
  assert.deepEqual(user.uploads, ["profile/user-caller/avatar-1-me.png"])
})

test("certificate grade averages quiz scores and PD hours come from lesson durations", async () => {
  const gradeModule = loadTypeScript(path.join(__dirname, "..", "certificates", "course-grade.ts"), {
    "@/lib/quiz/grading": loadTypeScript(path.join(__dirname, "..", "quiz", "grading.ts"), {}),
  })
  const tables = {
    lessons: [
      { id: 1, estimated_duration: 60 },
      { id: 2, estimated_duration: 30 },
      { id: 3, estimated_duration: 10 },
    ],
    quiz_settings: [{ lesson_id: 1, enabled: true }, { lesson_id: 2, enabled: true }, { lesson_id: 3, enabled: false }],
    quiz_questions: [
      { id: 11, lesson_id: 1, question_type: "true-false", question_data: { correctAnswer: true }, points: 1 },
      { id: 21, lesson_id: 2, question_type: "true-false", question_data: { correctAnswer: true }, points: 1 },
      { id: 22, lesson_id: 2, question_type: "true-false", question_data: { correctAnswer: true }, points: 1 },
    ],
    quiz_results: [
      { lesson_id: 1, quiz_question_id: 11, user_answer: "0" }, // correct -> 100%
      { lesson_id: 2, quiz_question_id: 21, user_answer: "0" }, // correct
      { lesson_id: 2, quiz_question_id: 22, user_answer: "1" }, // wrong -> 50%
    ],
  }
  const supabase = {
    from(table) {
      const rows = tables[table] || []
      return {
        select() { return this },
        eq() { return this },
        in() { return this },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject) },
      }
    },
  }
  const result = await gradeModule.getCourseGradeAndHours(supabase, "learner", 1)
  assert.equal(result.grade, "75%") // average of 100% and 50%
  assert.equal(result.pdHours, "2") // 100 minutes rounds up to the next 30-minute increment

  tables.quiz_questions = []
  tables.quiz_results = []
  const noQuizzes = await gradeModule.getCourseGradeAndHours(supabase, "learner", 1)
  assert.equal(noQuizzes.grade, null)
  assert.equal(noQuizzes.pdHours, "2")

  tables.lessons = [{ id: 1, estimated_duration: 45 }]
  const partial = await gradeModule.getCourseGradeAndHours(supabase, "learner", 1)
  assert.equal(partial.pdHours, "1") // 45 minutes rounds up to an hour

  tables.lessons = [{ id: 1, estimated_duration: 61 }]
  const overHour = await gradeModule.getCourseGradeAndHours(supabase, "learner", 1)
  assert.equal(overHour.pdHours, "1.5") // 61 minutes rounds up to an hour and a half
})

test("the grade clause is removed when a course has no grade", () => {
  const pdf = loadTypeScript(path.join(__dirname, "..", "certificates", "generate-pdf.ts"), {
    "pdfkit": function () {},
    "./pdfkit-font-patch": {},
    "./certificate-renderer": {},
  })
  const completion = "This certifies that [Student Name] has successfully completed [Course Name] with a final score of [Grade]."
  const achievement = "This certifies that [Student Name] has achieved distinction in [Course Name] with a final score of [Grade]."
  assert.equal(
    pdf.applyCertificatePlaceholders(completion, "92%", "1.5"),
    "This certifies that [Student Name] has successfully completed [Course Name] with a final score of 92%."
  )
  assert.equal(
    pdf.applyCertificatePlaceholders(completion, undefined, "1.5"),
    "This certifies that [Student Name] has successfully completed [Course Name]."
  )
  assert.equal(
    pdf.applyCertificatePlaceholders(achievement, undefined, "1.5"),
    "This certifies that [Student Name] has achieved distinction in [Course Name]."
  )
  assert.equal(
    pdf.applyCertificatePlaceholders("Professional development hours awarded: [PD Hours]", undefined, "1.5"),
    "Professional development hours awarded: 1.5"
  )
})
