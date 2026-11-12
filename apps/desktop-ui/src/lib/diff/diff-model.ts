import { Diff } from 'diff'

export type DiffViewMode = 'unified' | 'split' | 'result'

export interface DiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

export interface SplitDiffResult {
  oldParts: DiffPart[]
  newParts: DiffPart[]
}

export const DEFAULT_DIFF_VIEW_MODE: DiffViewMode = 'unified'

const VALID_MODES = new Set<DiffViewMode>(['unified', 'split', 'result'])

export function isDiffViewMode(value: unknown): value is DiffViewMode {
  return typeof value === 'string' && VALID_MODES.has(value as DiffViewMode)
}

export function resolveDiffMode(preferred?: string | null): DiffViewMode {
  return isDiffViewMode(preferred) ? preferred : DEFAULT_DIFF_VIEW_MODE
}

/** Previous (-1) or next (1) mode; stops at the first and the last one */
export type ModeStep = -1 | 1

const DIFF_MODE_ORDER: DiffViewMode[] = ['unified', 'split', 'result']
const PARALLEL_MODE_ORDER: ParallelViewMode[] = ['split', 'result']

function stepMode<T>(modes: readonly T[], current: T, step: ModeStep): T {
  const index = Math.min(
    Math.max(modes.indexOf(current) + step, 0),
    modes.length - 1
  )
  return modes[index]
}

export function stepDiffMode(
  current: DiffViewMode,
  step: ModeStep
): DiffViewMode {
  return stepMode(DIFF_MODE_ORDER, current, step)
}

export type ParallelViewMode = 'split' | 'result'

export function resolveParallelViewMode(
  preferred?: ParallelViewMode | string | null
): ParallelViewMode {
  return preferred === 'split' || preferred === 'result' ? preferred : 'split'
}

export function stepParallelViewMode(
  current: ParallelViewMode,
  step: ModeStep
): ParallelViewMode {
  return stepMode(PARALLEL_MODE_ORDER, current, step)
}

class UnicodeWordsWithSpaceDiff extends Diff<string, string, string> {
  override tokenize(value: string): string[] {
    // Matches:
    // 1. Newlines: (\r?\n)
    // 2. Full Unicode words/alphanumerics in ANY language (Cyrillic, Latin, Greek, CJK, etc.): [\p{L}\p{N}_]+
    // 3. Runs of spaces/tabs: [^\S\n\r]+
    // 4. Punctuation and symbols: [^\s\p{L}\p{N}_]
    const regex = /(\r?\n)|[\p{L}\p{N}_]+|[^\S\n\r]+|[^\s\p{L}\p{N}_]/gu
    return value.match(regex) || []
  }
}

const unicodeWordsWithSpaceDiff = new UnicodeWordsWithSpaceDiff()

/**
 * Computes word-level diff using whitespace-preserving word boundaries.
 * Supports full Unicode (Cyrillic, Latin, numbers, punctuation).
 */
export function computeWordDiff(oldText: string, newText: string): DiffPart[] {
  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    throw new Error('Both oldText and newText must be strings')
  }

  if (oldText === newText) {
    return oldText.length > 0 ? [{ value: oldText }] : []
  }

  const rawChanges = unicodeWordsWithSpaceDiff.diff(oldText, newText)
  return rawChanges.map((change) => {
    const part: DiffPart = { value: change.value }
    if (change.added) part.added = true
    if (change.removed) part.removed = true
    return part
  })
}

export function splitDiffParts(parts: readonly DiffPart[]): SplitDiffResult {
  const oldParts: DiffPart[] = []
  const newParts: DiffPart[] = []

  for (const part of parts) {
    if (part.added) {
      newParts.push({ value: part.value, added: true })
    } else if (part.removed) {
      oldParts.push({ value: part.value, removed: true })
    } else {
      oldParts.push({ value: part.value })
      newParts.push({ value: part.value })
    }
  }

  return { oldParts, newParts }
}

/** Returns true if there are actual added or removed tokens. */
export function hasDifferences(parts: DiffPart[]): boolean {
  return parts.some((p) => p.added || p.removed)
}
