/**
 * Webhook headers as the editor shows them. The rows live in the editor: a row
 * without a name or with a repeated name stays there, but only the rows that
 * make a valid header reach the config
 */
export type WebhookHeaderRow = [name: string, value: string]

/** Header names are compared without case, as HTTP does */
const headerKey = (name: string): string => name.trim().toLowerCase()

export function webhookHeaderRows(
  headers: Record<string, string> | undefined
): WebhookHeaderRow[] {
  return Object.entries(headers ?? {})
}

/**
 * The headers of the rows: a row without a name is skipped, and of the rows
 * with the same name the first one wins
 */
export function webhookHeadersFromRows(
  rows: readonly WebhookHeaderRow[]
): Record<string, string> {
  const seen = new Set<string>()
  const headers: Record<string, string> = {}
  for (const [name, value] of rows) {
    const key = headerKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    headers[name.trim()] = value
  }
  return headers
}

/** The indexes of the rows whose name repeats an earlier row: they are ignored */
export function duplicateWebhookHeaderRows(
  rows: readonly WebhookHeaderRow[]
): Set<number> {
  const seen = new Set<string>()
  const duplicates = new Set<number>()
  rows.forEach(([name], index) => {
    const key = headerKey(name)
    if (!key) return
    if (seen.has(key)) duplicates.add(index)
    else seen.add(key)
  })
  return duplicates
}

/** Whether two header sets are the same, in the same order */
export function isSameWebhookHeaders(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const [left, right] = [Object.entries(a), Object.entries(b)]
  return (
    left.length === right.length &&
    left.every(
      ([name, value], i) => right[i][0] === name && right[i][1] === value
    )
  )
}

export function updateWebhookHeaderRow(
  rows: readonly WebhookHeaderRow[],
  index: number,
  part: 0 | 1,
  value: string
): WebhookHeaderRow[] {
  return rows.map((row, i) => {
    if (i !== index) return row
    const next: WebhookHeaderRow = [...row]
    next[part] = value
    return next
  })
}

/** Adds an empty row, unless one is still waiting for its name */
export function addWebhookHeaderRow(
  rows: readonly WebhookHeaderRow[]
): WebhookHeaderRow[] | null {
  if (rows.some(([name]) => !name.trim())) return null
  return [...rows, ['', '']]
}

export function removeWebhookHeaderRow(
  rows: readonly WebhookHeaderRow[],
  index: number
): WebhookHeaderRow[] {
  return rows.filter((_, i) => i !== index)
}
