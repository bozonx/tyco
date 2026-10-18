/**
 * Why a text got into the editor history:
 *
 * - `output` — inserted into a window or copied to the clipboard;
 * - `draft` — unsent text: discarded from the editor or kept there while the
 *   window was hidden;
 * - `source` — snapshot taken right before an AI transformation.
 */
export type EditorHistoryKind = 'output' | 'draft' | 'source'

/** The AI transformation a `source` entry was taken before. */
export type EditorHistoryOperation =
  'aiTask' | 'translation' | 'correction' | 'voiceCorrection'

export interface EditorHistoryEntry {
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation
  /** A draft this entry supersedes: the same editing session saved again. */
  replaceId?: string
}

export interface EditorHistoryItem {
  id: string
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation
  /** Unix time in milliseconds, 0 when unknown. */
  createdAt: number
  /** What the AI turned a `source` entry into. */
  result?: string
  /** The `result` of a `source` entry was inserted into a window or copied. */
  isResultApplied?: boolean
}
