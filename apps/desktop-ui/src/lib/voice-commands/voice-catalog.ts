import type { CommandConfig } from '@tyco/shared'
import { isBuiltInVoiceCommand } from './built-in-voice-commands'
import type { VoiceCandidate } from './voice-resolver'

export type VoiceCatalogGroup = 'builtIn' | 'custom'

/**
 * One row of the voice command list. The standard translation is a command per
 * language, yet the user sees one function whose language is a parameter.
 */
export interface VoiceCatalogEntry {
  key: string
  group: VoiceCatalogGroup
  toolId: string
  /** The first one is chosen when the user picks the row by hand */
  commands: readonly CommandConfig[]
}

const TRANSLATE_TOOL_ID = 'core.translate'

export const isTranslateEntry = (entry: VoiceCatalogEntry) =>
  entry.group === 'builtIn' && entry.toolId === TRANSLATE_TOOL_ID

export function buildVoiceCatalog(
  catalog: readonly CommandConfig[],
  defaultTranslationId?: string
): VoiceCatalogEntry[] {
  const builtIn: VoiceCatalogEntry[] = []
  const custom: VoiceCatalogEntry[] = []
  const translations: CommandConfig[] = []
  for (const command of catalog) {
    if (!isBuiltInVoiceCommand(command))
      custom.push({
        key: command.id,
        group: 'custom',
        toolId: command.toolId,
        commands: [command],
      })
    else if (command.toolId === TRANSLATE_TOOL_ID) {
      if (!translations.length)
        builtIn.push({
          key: `builtin:${TRANSLATE_TOOL_ID}`,
          group: 'builtIn',
          toolId: TRANSLATE_TOOL_ID,
          commands: translations,
        })
      translations.push(command)
    } else
      builtIn.push({
        key: command.id,
        group: 'builtIn',
        toolId: command.toolId,
        commands: [command],
      })
  }
  const preferred = translations.findIndex(
    (command) => command.id === defaultTranslationId
  )
  if (preferred > 0) translations.unshift(...translations.splice(preferred, 1))
  return [...builtIn, ...custom]
}

/** The first candidate of each row that the recognizer points at */
export function matchVoiceCatalog(
  entries: readonly VoiceCatalogEntry[],
  candidates: readonly VoiceCandidate[]
): Map<string, VoiceCandidate> {
  const matches = new Map<string, VoiceCandidate>()
  for (const candidate of candidates) {
    const entry = entries.find((item) =>
      item.commands.some((command) => command.id === candidate.commandId)
    )
    if (entry && !matches.has(entry.key)) matches.set(entry.key, candidate)
  }
  return matches
}
