const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const typescript = require("typescript")

function load(file, mocks = {}) {
  const code = typescript.transpileModule(fs.readFileSync(path.join(__dirname, `${file}.ts`), "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function("require", "module", "exports", code)((id) => mocks[id] || require(id), loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const html = load("html")

test("extracts readable text, ordered links and supported YouTube URLs", () => {
  const page = html.parseSourceHtml(`<html><head><title>Course</title><meta name="copyright" content="Owner"></head>
    <body><nav>Navigation</nav><main><p>Overview</p>
    <a href="/lesson/one">Lesson one</a><iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"></iframe>
    <a href="https://youtu.be/lmnopqrstuv">Video</a><script>hidden</script></main></body></html>`, "https://example.com/course")
  assert.equal(page.title, "Course")
  assert.equal(page.author, "Owner")
  assert.match(page.text, /Overview/)
  assert.doesNotMatch(page.text, /Navigation|hidden/)
  assert.equal(page.links[0].url, "https://example.com/lesson/one")
  assert.deepEqual(page.videoIds, ["abcdefghijk", "lmnopqrstuv"])
  assert.equal(html.youtubeId("https://youtube.com.attacker.test/watch?v=abcdefghijk"), null)
})

test("YouTube descriptions suggest modules with bounded video ranges and a merged introduction", async () => {
  const description = [
    "About the video", "0:00 - Introduction", "1:05 - Module 1: Getting started",
    "7:13 - Module 2: Teams", "13:35 - Module 3: Chat", "20:07 - Module 4: Meetings",
    "37:41 - Module 5: Files", "42:42 - Module 6: Tools", "49:53 - Module 7: AI",
    "53:36 - Module 8: Workflow",
  ].join("\n")
  const player = { playabilityStatus: { status: "OK" }, videoDetails: {
    videoId: "abcdefghijk", title: "Video", author: "Owner", lengthSeconds: "3464", shortDescription: description,
  } }
  const adapter = load("youtube", {
    "../fetch": { validateImportUrl: (url) => new URL(url),
      fetchImportUrl: async () => ({ body: `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>` }) },
  })
  const result = await adapter.readYouTubeCourse("https://youtu.be/abcdefghijk", "abcdefghijk")
  assert.equal(result.lessons.length, 1)
  assert.equal(result.chapterSuggestions.length, 8)
  assert.equal(result.chapterSuggestions[0].title, "Module 1: Getting started")
  assert.deepEqual(result.chapterSuggestions.map((lesson) => [lesson.youtube.startSeconds, lesson.youtube.endSeconds]),
    [[0, 433], [433, 815], [815, 1207], [1207, 2261], [2261, 2562], [2562, 2993], [2993, 3216], [3216, 3464]])
  assert.equal(result.chapterSuggestions[0].durationMinutes, 8)
  assert.deepEqual(adapter.youtubeChapters("0:00 Intro\n2:00 First\n1:00 Second", 180, "abcdefghijk", "https://example.com"), [])
  assert.deepEqual(adapter.youtubeChapters("0:00 Intro", 180, "abcdefghijk", "https://example.com"), [])
  player.videoDetails.shortDescription = Array.from({ length: 41 }, (_, index) =>
    `${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")} Chapter ${index + 1}`).join("\n")
  const tooMany = await adapter.readYouTubeCourse("https://youtu.be/abcdefghijk", "abcdefghijk")
  assert.equal(tooMany.chapterSuggestions, undefined)
  assert.match(tooMany.chapterWarning, /More than 40/)
  assert.equal(tooMany.lessons.length, 1)
})

test("YouTube metadata errors are reported rather than silently importing a different video", async () => {
  const adapter = load("youtube", {
    "../fetch": { validateImportUrl: (url) => new URL(url), fetchImportUrl: async () => ({ body: "<html></html>" }) },
  })
  await assert.rejects(adapter.readYouTubeCourse("https://youtu.be/abcdefghijk", "abcdefghijk"), /metadata/)
})

test("LearnFree adapter preserves the list and identifies source-only quizzes", async () => {
  const list = {
    isSuccessful: true,
    data: { lessonData: [
      { lessonId: 1, name: "First lesson", duration: "0:12", description: "" },
      { lessonId: 2, name: "Source quiz", duration: "0:8", description: "" },
    ] },
  }
  const responses = [
    list,
    { isSuccessful: true, data: { courseName: "Course", lessonDetails: { stepDetails: [
      { stepType: 1, content: '<p>Lesson text</p><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>' },
    ] } } },
    { isSuccessful: true, data: { courseName: "Course", lessonDetails: { stepDetails: [{ stepType: 3, content: "" }] } } },
  ]
  const adapter = load("learnfree", {
    "../fetch": { fetchImportUrl: async () => ({ body: JSON.stringify(responses.shift()) }) },
    "./html": html,
  })
  assert.equal(adapter.learnFreeSlug("https://www.learnfree.org/series/excel-foundations"), "excel-foundations")
  assert.equal(adapter.learnFreeSlug("https://www.learnfree.org/episode/excel-foundations/?id=1"), "excel-foundations")
  assert.equal(adapter.learnFreeSlug("https://learnfree.org.attacker.test/series/excel-foundations"), null)
  const course = await adapter.readLearnFreeCourse("https://www.learnfree.org/episode/excel-foundations/?id=1", "excel-foundations")
  assert.deepEqual(course.lessons.map((lesson) => lesson.title), ["First lesson", "Source quiz"])
  assert.equal(course.lessons[0].durationMinutes, 12)
  const lesson = await adapter.readLearnFreeLesson("excel-foundations", course.lessons[0])
  assert.equal(lesson.sourceQuiz, false)
  assert.deepEqual(lesson.videoIds, ["abcdefghijk"])
  assert.equal((await adapter.readLearnFreeLesson("excel-foundations", course.lessons[1])).sourceQuiz, true)
})
