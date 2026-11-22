import { type CommandConfig, commandTakesSelection } from '@tyco/shared'
import { commandTakesText } from '../commands/command-runtime'
import type { OperationLookup } from '../operations/operation-types'

/**
 * How a voice call of the command uses the selected text:
 *
 * - `text`: the command runs on the selection, nothing more is spoken
 * - `attach`: the spoken words follow the selection, as a question about it
 * - `context`: the command gets it apart, as `{{SELECTION}}` of a script or a
 *   webhook
 * - `none`: the command does not use it
 */
export type VoiceSelectionUse = 'text' | 'attach' | 'context' | 'none'

export function voiceSelectionUse(
  command: CommandConfig,
  operations: OperationLookup
): VoiceSelectionUse {
  if (commandTakesSelection(command)) return 'context'
  if (!commandTakesText(command, operations)) return 'none'
  return operations.get(command.operationId)?.voiceSelectionRole ?? 'none'
}

/** The selection the command takes as its text, if any */
export function selectionAsText(
  use: VoiceSelectionUse,
  selectionText: string | undefined
): string | undefined {
  if (use !== 'text' && use !== 'attach') return undefined
  return selectionText?.trim() ? selectionText : undefined
}

/**
 * The text the command runs on: the selection for `text`, the selection and
 * then the spoken words for `attach`, the spoken words otherwise
 */
export function voiceRunText(
  use: VoiceSelectionUse,
  spoken: string,
  selectionText: string | undefined
): string {
  const selection = selectionAsText(use, selectionText)
  if (selection === undefined) return spoken
  if (use === 'text') return selection
  return spoken.trim()
    ? `${selection.trimEnd()}\n\n${spoken.trim()}`
    : selection
}

/** Whether the command needs no spoken text: it runs on the selection */
export function runsOnSelection(
  use: VoiceSelectionUse,
  selectionText: string | undefined
): boolean {
  return use === 'text' && selectionAsText(use, selectionText) !== undefined
}
