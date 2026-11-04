import type { SnippetConfig } from '@tyco/shared'

const ID_PREFIX = 'snippet'

/** Finds next unique snippet id formatted as `snippet-<n>`. */
export function nextSnippetId(existing: readonly { id: string }[]): string {
  const ids = new Set(existing.map((item) => item.id))
  let count = 1
  while (ids.has(`${ID_PREFIX}-${count}`)) {
    count += 1
  }
  return `${ID_PREFIX}-${count}`
}

/** Checks whether an identical snippet already exists (trimmed comparison). */
export function isDuplicateSnippet(
  snippets: readonly SnippetConfig[],
  text: string
): boolean {
  const target = text.trim()
  if (!target) return false
  return snippets.some((item) => item.text.trim() === target)
}

/** Filters snippets by query matching against the full text (case-insensitive). */
export function filterSnippets(
  snippets: readonly SnippetConfig[],
  query: string
): SnippetConfig[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return [...snippets]
  }
  return snippets.filter((item) =>
    item.text.toLowerCase().includes(normalizedQuery) ||
    (item.name ?? '').toLowerCase().includes(normalizedQuery)
  )
}

export type AddSnippetResult =
  | { success: true; item: SnippetConfig; items: SnippetConfig[] }
  | { success: false; reason: 'empty' | 'duplicate' }

/** Appends a new snippet to the list if valid and non-duplicate. */
export function addSnippet(
  snippets: readonly SnippetConfig[],
  text: string
): AddSnippetResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, reason: 'empty' }
  }
  if (isDuplicateSnippet(snippets, trimmed)) {
    return { success: false, reason: 'duplicate' }
  }
  const item: SnippetConfig = { id: nextSnippetId(snippets), text }
  return { success: true, item, items: [...snippets, item] }
}

/** Updates the text of an existing snippet. */
export function updateSnippet(
  snippets: readonly SnippetConfig[],
  id: string,
  text: string
): SnippetConfig[] {
  return snippets.map((item) => (item.id === id ? { ...item, text } : item))
}

/** Removes a snippet by id. */
export function removeSnippet(
  snippets: readonly SnippetConfig[],
  id: string
): SnippetConfig[] {
  return snippets.filter((item) => item.id !== id)
}

/** Moves a snippet from one index to another (drag-and-drop reordering). */
export function reorderSnippets(
  snippets: readonly SnippetConfig[],
  fromIndex: number,
  toIndex: number
): SnippetConfig[] {
  if (
    fromIndex < 0 ||
    fromIndex >= snippets.length ||
    toIndex < 0 ||
    toIndex >= snippets.length ||
    fromIndex === toIndex
  ) {
    return [...snippets]
  }
  const result = [...snippets]
  const [removed] = result.splice(fromIndex, 1)
  if (removed) {
    result.splice(toIndex, 0, removed)
  }
  return result
}

/** Returns a short single-line preview of the snippet text. */
export function snippetPreview(text: string, maxLength = 80): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? ''
  if (firstLine.length <= maxLength) {
    return firstLine
  }
  return `${firstLine.slice(0, maxLength - 1).trimEnd()}…`
}
