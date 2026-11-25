import { formatDialogClock } from './dialog-export'
import { turnText, turnTranslation, type DialogTurn } from './dialog-transcript'

export interface DialogSelectionExportOptions {
  includeMe: boolean
  useTranslation: boolean
  labels: { me: string; remote: string }
  formatTime?: (startMs: number) => string
}

/**
 * Returns the text of a single turn according to translation preference. Falls
 * back to the original text if translation is absent.
 */
export function getTurnContent(
  turn: DialogTurn,
  useTranslation: boolean
): string {
  if (turn.side === 'remote' && useTranslation) {
    const translation = turnTranslation(turn)
    if (translation.trim()) return translation
  }
  return turnText(turn)
}

/**
 * Formats selected turns into text.
 *
 * - When a single turn is selected, outputs its plain content.
 * - When multiple turns from different speakers are selected, outputs
 *   speaker-attributed lines with timestamps.
 * - When multiple turns from the same speaker are selected (e.g. only remote),
 *   outputs lines with timestamps only, avoiding redundant speaker labels.
 */
export function formatSelectedTurns(
  turns: readonly DialogTurn[],
  options: DialogSelectionExportOptions
): string {
  const filtered = options.includeMe
    ? turns
    : turns.filter((turn) => turn.side !== 'me')
  if (filtered.length === 0) return ''

  const formatTime = options.formatTime ?? formatDialogClock

  if (filtered.length === 1) {
    return getTurnContent(filtered[0], options.useTranslation)
  }

  const hasMultipleSpeakers = new Set(filtered.map((t) => t.side)).size > 1

  return filtered
    .map((turn) => {
      const time = formatTime(turn.startMs)
      const content = getTurnContent(turn, options.useTranslation)
      if (hasMultipleSpeakers) {
        const speaker = options.labels[turn.side]
        return `[${time}] ${speaker}: ${content}`
      }
      return `[${time}] ${content}`
    })
    .join('\n')
}

/**
 * Returns all turn IDs between anchorId and targetId (inclusive) based on
 * allTurns order.
 */
export function getTurnRange(
  allTurns: readonly { id: string }[],
  anchorId: string,
  targetId: string
): string[] {
  const anchorIndex = allTurns.findIndex((t) => t.id === anchorId)
  const targetIndex = allTurns.findIndex((t) => t.id === targetId)

  if (anchorIndex === -1 || targetIndex === -1) {
    return targetIndex !== -1
      ? [targetId]
      : anchorIndex !== -1
        ? [anchorId]
        : []
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return allTurns.slice(start, end + 1).map((t) => t.id)
}

/**
 * Handles Shift+click selection on a dialog turn.
 *
 * - If no items are selected, selects clicked turn and sets it as anchor.
 * - If only the clicked turn was selected and clicked again, deselects it.
 * - Otherwise extends the selection from the anchor to the clicked turn.
 */
export function toggleShiftTurnSelection(
  currentSelectedIds: readonly string[],
  clickedId: string,
  allTurns: readonly { id: string }[],
  anchorId: string | null
): { selectedIds: string[]; anchorId: string | null } {
  if (currentSelectedIds.length === 0) {
    return { selectedIds: [clickedId], anchorId: clickedId }
  }

  if (currentSelectedIds.length === 1 && currentSelectedIds[0] === clickedId) {
    return { selectedIds: [], anchorId: null }
  }

  const effectiveAnchor = anchorId ?? currentSelectedIds[0]
  const range = getTurnRange(allTurns, effectiveAnchor, clickedId)
  return { selectedIds: range, anchorId: effectiveAnchor }
}

/**
 * Toggles a single turn selection (Ctrl/Cmd-click or individual checkbox
 * toggle).
 */
export function toggleSingleTurnSelection(
  currentSelectedIds: readonly string[],
  clickedId: string,
  anchorId: string | null
): { selectedIds: string[]; anchorId: string | null } {
  if (currentSelectedIds.includes(clickedId)) {
    const next = currentSelectedIds.filter((id) => id !== clickedId)
    return {
      selectedIds: next,
      anchorId:
        next.length === 0 ? null : anchorId === clickedId ? next[0] : anchorId,
    }
  }

  return {
    selectedIds: [...currentSelectedIds, clickedId],
    anchorId: anchorId ?? clickedId,
  }
}

/**
 * Selects all turns between the existing anchor (or first selected) and
 * targetId.
 */
export function selectRangeUpTo(
  currentSelectedIds: readonly string[],
  targetId: string,
  allTurns: readonly { id: string }[],
  anchorId: string | null
): { selectedIds: string[]; anchorId: string | null } {
  const effectiveAnchor = anchorId ?? currentSelectedIds[0] ?? targetId
  const range = getTurnRange(allTurns, effectiveAnchor, targetId)
  return { selectedIds: range, anchorId: effectiveAnchor }
}
