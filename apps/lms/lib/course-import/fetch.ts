import { lookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP } from "node:net"

const blocked = new BlockList()
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4")
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blocked.addSubnet(address, prefix, "ipv6")
const globalIPv6 = new BlockList()
globalIPv6.addSubnet("2000::", 3, "ipv6")

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, "ipv4")
  if (family === 6) return globalIPv6.check(address, "ipv6") && !blocked.check(address, "ipv6")
  return false
}

export function validateImportUrl(value: string, allowedDomains = process.env.COURSE_IMPORT_ALLOWED_DOMAINS): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS URL.")
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only HTTP or HTTPS URLs without credentials are allowed.")
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase()
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Local and internal addresses are not allowed.")
  }
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error("Private or reserved addresses are not allowed.")
  if (allowedDomains?.trim()) {
    const domains = allowedDomains.split(",").map((domain) => domain.trim().replace(/\.$/, "").toLowerCase()).filter(Boolean)
    if (!domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      throw new Error(`The domain ${hostname} is not allowed for course imports.`)
    }
  }
  url.hash = ""
  return url
}

export async function fetchImportUrl(value: string, callerSignal?: AbortSignal): Promise<{ url: string; body: string; contentType: string }> {
  for (let attempt = 1; ; attempt++) {
    callerSignal?.throwIfAborted()
    const timeout = AbortSignal.timeout(8500)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
    try {
      return await fetchImportUrlOnce(value, signal)
    } catch (error) {
      if (callerSignal?.aborted || !timeout.aborted) throw error
      if (attempt === 3) throw new Error("Source request timed out after 3 attempts. Resume the import to retry.", { cause: error })
      console.warn(`[Course import] Source request timed out; retrying (attempt ${attempt + 1} of 3).`)
    }
  }
}

async function fetchImportUrlOnce(value: string, signal: AbortSignal): Promise<{ url: string; body: string; contentType: string }> {
  let url = validateImportUrl(value)
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted()
    const host = url.hostname.replace(/^\[|\]$/g, "")
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("Source request timed out.")), { once: true })),
    ])
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new Error("Source resolves to a private or reserved address.")
    }
    const selected = addresses[0]
    const result = await new Promise<{ status: number; location?: string; body: string; contentType: string }>((resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest
      const req = send({
        protocol: url.protocol,
        hostname: selected.address,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { Host: url.host, Accept: "text/html, application/json;q=0.9", "Accept-Encoding": "identity" },
        servername: isIP(host) ? undefined : host,
        signal,
      }, async (response) => {
        try {
          const status = response.statusCode || 0
          if (status >= 300 && status < 400) {
            response.resume()
            resolve({ status, location: response.headers.location, body: "", contentType: "" })
            return
          }
          if (status < 200 || status >= 300) throw new Error(`Source returned HTTP ${status}.`)
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of response) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += buffer.length
            if (size > 5 * 1024 * 1024) throw new Error("Source response exceeds the 5 MB limit.")
            chunks.push(buffer)
          }
          resolve({ status, body: Buffer.concat(chunks).toString("utf8"), contentType: response.headers["content-type"] || "" })
        } catch (error) {
          response.destroy()
          reject(error)
        }
      })
      req.on("error", reject)
      req.end()
    })
    if (result.status >= 300 && result.status < 400) {
      if (!result.location || redirects >= 3) throw new Error("Source has too many redirects or an invalid redirect.")
      url = validateImportUrl(new URL(result.location, url).href)
      continue
    }
    return { url: url.href, body: result.body, contentType: result.contentType }
  }
}
