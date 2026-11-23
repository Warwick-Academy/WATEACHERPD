import { Parser } from "htmlparser2"

export function youtubeId(value: string): string | null {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    let id: string | null = null
    if (host === "youtu.be") id = url.pathname.split("/")[1]
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
      id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/embed\/([^/]+)/)?.[1] || null
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}

export function parseSourceHtml(html: string, pageUrl: string) {
  const text: string[] = []
  const title: string[] = []
  const links: { url: string; text: string }[] = []
  const videos = new Set<string>()
  let description = ""
  let author = ""
  let ignoredDepth = 0
  let titleDepth = 0
  let link: { url: string; text: string } | null = null
  const ignoredTags = new Set(["script", "style", "noscript", "nav", "footer", "header", "svg", "iframe"])
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "meta") {
        const key = (attributes.name || attributes.property || "").toLowerCase()
        if (key === "description" || key === "og:description") description ||= attributes.content || ""
        if (key === "copyright") author ||= (attributes.content || "").replace(/^©\s*(?:\d{4}\s*)?/, "").trim()
      }
      if (name === "iframe" && attributes.src) {
        try {
          const id = youtubeId(new URL(attributes.src, pageUrl).href)
          if (id) videos.add(id)
        } catch {
          // Ignore invalid embedded URLs.
        }
      }
      if (name === "a" && attributes.href && !ignoredDepth) {
        try {
          const url = new URL(attributes.href, pageUrl).href
          const id = youtubeId(url)
          if (id) videos.add(id)
          link = { url, text: "" }
        } catch {
          link = null
        }
      }
      if (name === "title") titleDepth++
      if (ignoredDepth > 0 || ignoredTags.has(name)) ignoredDepth++
      else text.push(" ")
    },
    ontext(value) {
      if (titleDepth) title.push(value)
      else if (!ignoredDepth) {
        text.push(value)
        if (link) link.text += value
      }
    },
    onclosetag(name) {
      if (name === "title") titleDepth--
      if (ignoredDepth > 0) ignoredDepth--
      else text.push(" ")
      if (name === "a" && link) {
        links.push(link)
        link = null
      }
    },
  }, { decodeEntities: true })
  parser.end(html)
  return {
    title: title.join("").replace(/\s+/g, " ").trim(),
    description: description.trim(),
    author: author.trim(),
    text: text.join("").replace(/\s+/g, " ").trim().slice(0, 30000),
    links,
    videoIds: [...videos],
  }
}
