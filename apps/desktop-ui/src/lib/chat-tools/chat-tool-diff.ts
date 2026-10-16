import { diffLines } from 'diff'

/** One line of a change as the approval card shows it */
export type ChangeLine =
  | { kind: 'added' | 'removed' | 'context'; text: string }
  /** Unchanged lines left out between two hunks */
  | { kind: 'gap'; count: number }

export interface FileChangeSummary {
  lines: ChangeLine[]
  addedCount: number
  removedCount: number
  /** Changed lines left out beyond the limit */
  hiddenCount: number
}

/** Unchanged lines shown around each change */
const CONTEXT_LINES = 3
/** The most lines the card shows; a whole new book is not rendered */
const MAX_CHANGE_LINES = 400

const splitLines = (value: string) => {
  const lines = value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * The lines a write or an edit changes, with a little of what is around them,
 * as a unified diff does. A new file is all added lines
 */
export function summarizeFileChange(
  before: string | null,
  after: string,
  maxLines = MAX_CHANGE_LINES
): FileChangeSummary {
  const rows: Array<{ kind: 'added' | 'removed' | 'context'; text: string }> =
    []
  for (const change of diffLines(before ?? '', after)) {
    const kind = change.added ? 'added' : change.removed ? 'removed' : 'context'
    for (const text of splitLines(change.value)) rows.push({ kind, text })
  }
  const isNear = rows.map(() => false)
  rows.forEach((row, index) => {
    if (row.kind === 'context') return
    for (
      let near = Math.max(0, index - CONTEXT_LINES);
      near <= Math.min(rows.length - 1, index + CONTEXT_LINES);
      near++
    )
      isNear[near] = true
  })

  const summary: FileChangeSummary = {
    lines: [],
    addedCount: rows.filter((row) => row.kind === 'added').length,
    removedCount: rows.filter((row) => row.kind === 'removed').length,
    hiddenCount: 0,
  }
  let skipped = 0
  rows.forEach((row, index) => {
    if (!isNear[index]) {
      skipped++
      return
    }
    if (summary.lines.length >= maxLines) {
      if (row.kind !== 'context') summary.hiddenCount++
      return
    }
    if (skipped) summary.lines.push({ kind: 'gap', count: skipped })
    skipped = 0
    summary.lines.push(row)
  })
  if (skipped && summary.lines.length < maxLines)
    summary.lines.push({ kind: 'gap', count: skipped })
  return summary
}
