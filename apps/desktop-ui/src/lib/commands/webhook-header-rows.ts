/** Webhook headers as the editor shows them: a row with an empty name stays */
export type WebhookHeaderRow = [name: string, value: string]

export function webhookHeaderRows(
  headers: Record<string, string> | undefined
): WebhookHeaderRow[] {
  return Object.entries(headers ?? {})
}

export function webhookHeadersFromRows(
  rows: WebhookHeaderRow[]
): Record<string, string> {
  return Object.fromEntries(rows)
}

export function updateWebhookHeaderRow(
  rows: WebhookHeaderRow[],
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
  rows: WebhookHeaderRow[]
): WebhookHeaderRow[] | null {
  if (rows.some(([name]) => !name)) return null
  return [...rows, ['', '']]
}

export function removeWebhookHeaderRow(
  rows: WebhookHeaderRow[],
  index: number
): WebhookHeaderRow[] {
  return rows.filter((_, i) => i !== index)
}
