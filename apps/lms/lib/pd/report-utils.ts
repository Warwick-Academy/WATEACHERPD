export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const result = await page(from, from + 999)
    if (result.error) throw new Error(result.error.message)
    if (!result.data) throw new Error("The database did not return the requested records.")
    rows.push(...result.data)
    if (result.data.length < 1000) return rows
  }
}

export type TeacherTrend = {
  year_id: number; teacher_id: string; teacher_name: string; department: string | null; phase: string
  category_id: number; category: string; category_order: number; criterion_id: number; criterion: string
  criterion_order: number; always_mostly: number; sometimes: number; no: number; na: number; total: number
}

export function filterTrends(rows: TeacherTrend[], department: string, phase: string) {
  return rows.filter((row) => (department === "all" || row.department === department) && (phase === "all" || row.phase === phase))
}

export function sumHours(rows: { hours: number | string }[]) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.hours), 0) * 100) / 100
}

export function summariseTrends(rows: TeacherTrend[]) {
  const groups = new Map<number, TeacherTrend>()
  for (const row of rows) {
    const existing = groups.get(row.criterion_id)
    if (!existing) {
      groups.set(row.criterion_id, { ...row, always_mostly: Number(row.always_mostly), sometimes: Number(row.sometimes), no: Number(row.no), na: Number(row.na), total: Number(row.total) })
    } else {
      existing.always_mostly += Number(row.always_mostly)
      existing.sometimes += Number(row.sometimes)
      existing.no += Number(row.no)
      existing.na += Number(row.na)
      existing.total += Number(row.total)
    }
  }
  return [...groups.values()].sort((a, b) => (b.sometimes + b.no) - (a.sometimes + a.no) || a.category_order - b.category_order || a.criterion_order - b.criterion_order)
}

export function csvText(rows: (string | number | null | undefined)[][]) {
  return "\uFEFF" + rows.map((row) => row.map((value) => {
    let text = String(value ?? "")
    if (typeof value === "string" && (/^[\t\r\n]/.test(text) || /^[\s\u0000-\u001f]*[=+\-@]/.test(text))) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }).join(",")).join("\r\n")
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
