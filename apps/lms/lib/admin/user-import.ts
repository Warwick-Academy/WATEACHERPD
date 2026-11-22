export interface ImportRow {
  name: string
  email: string
  userType: "user" | "admin"
  error?: string
}

export function parseUserCsv(text: string, existingEmails: readonly string[]): ImportRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  let closedQuote = false
  const input = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') { quoted = false; closedQuote = true }
      else cell += char
    } else if (char === '"' && cell === "" && !closedQuote) {
      quoted = true
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(cell)
      cell = ""
      closedQuote = false
      if (char !== ",") {
        if (char === "\r" && input[i + 1] === "\n") i++
        if (row.some((value) => value.trim())) rows.push(row)
        row = []
      }
    } else if (char === '"' || (closedQuote && !/\s/.test(char))) {
      throw new Error("Invalid CSV quoting")
    } else if (!closedQuote) {
      cell += char
    }
  }
  if (quoted) throw new Error("Unclosed quoted CSV field")
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  const header = rows.shift()?.map((value) => value.trim().toLowerCase())
  if (!header || !header.includes("name") || !header.includes("email") ||
      header.some((value, index) => header.indexOf(value) !== index) ||
      header.some((value) => !["name", "email", "role"].includes(value))) {
    throw new Error("CSV must have name,email and an optional role column")
  }
  if (rows.length === 0) throw new Error("CSV contains no user rows")
  const existing = new Set(existingEmails.map((email) => email.trim().toLowerCase()))
  const seen = new Set<string>()
  return rows.map((cells) => {
    const name = (cells[header.indexOf("name")] || "").trim()
    const email = (cells[header.indexOf("email")] || "").trim().toLowerCase()
    const roleIndex = header.indexOf("role")
    const role = roleIndex === -1 ? "" : (cells[roleIndex] || "").trim().toLowerCase()
    let error = ""
    if (cells.length !== header.length) error = "Wrong number of columns"
    else if (!name) error = "Name is required"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = "Invalid email"
    else if (!["", "teacher", "learner", "user", "admin"].includes(role)) error = "Role must be teacher or admin"
    else if (existing.has(email)) error = "Email already exists"
    else if (seen.has(email)) error = "Duplicate email in CSV"
    if (email) seen.add(email)
    return { name, email, userType: role === "admin" ? "admin" : "user", ...(error ? { error } : {}) }
  })
}

export function exportUserResults(rows: readonly { name: string; email: string; password: string; status: string }[]): string {
  const escape = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
    return `"${safe.replace(/"/g, '""')}"`
  }
  return [["name", "email", "temporary password", "status"], ...rows.map((row) => [row.name, row.email, row.password, row.status])]
    .map((row) => row.map(escape).join(",")).join("\r\n")
}
