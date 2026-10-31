import type { CommandConfig } from '@tyco/shared'

import { isBuiltInVoiceCommand } from './built-in-voice-commands'
import { commandLabel } from '../commands/command-runtime'
import { getLanguageLabelKey } from '../locale/language'
import { isTranslateEntry, type VoiceCatalogEntry } from './voice-catalog'
import {
  grammarVariants,
  type VoiceCandidate,
  type VoiceResolution,
} from './voice-resolver'

export const DEFAULT_TRANSLATION_ID = 'builtin:voice:translate:en-US'

export interface VoiceRouteLike {
  commandId: string
  phrase: string
  parameters: ReadonlyArray<{ variants: readonly string[] }>
}

export interface VoiceNotice {
  kind: 'info' | 'warning' | 'error'
  message: string
}

/** The standard translation, one command per language */
export const isTranslationCommand = (command: CommandConfig): boolean =>
  command.toolId === 'core.translate' && isBuiltInVoiceCommand(command)

export const voiceCommandLanguageLabel = (
  command: CommandConfig,
  t: (key: string) => string
): string => t(getLanguageLabelKey(String(command.toolConfig.language)))

export const voiceEntryLabel = (
  entry: VoiceCatalogEntry,
  t: (key: string) => string
): string =>
  entry.group === 'custom'
    ? commandLabel(entry.commands[0]!)
    : isTranslateEntry(entry)
      ? t('tools.translate')
      : t('tools.askInChat')

export const voiceEntryLanguage = (
  entry: VoiceCatalogEntry,
  marks: ReadonlyMap<string, VoiceCandidate>,
  t: (key: string) => string
): string => {
  if (!isTranslateEntry(entry)) return ''
  const id = marks.get(entry.key)?.commandId
  const command = entry.commands.find((item) => item.id === id)
  return command ? voiceCommandLanguageLabel(command, t) : ''
}

/** The language slot of a translation template, see `compileVoiceRoutes` */
const LANGUAGE_SLOT = /\{language\}|~/u

/**
 * A grammar entry as written: `t` would interpolate its `{language}` slot. The
 * slot is passed back to itself to keep it.
 */
const rawGrammar = (
  t: (key: string, params?: Record<string, string>) => string,
  key: string
) => t(key, { language: '{language}' })

export const voiceEntryPhrases = (
  entry: VoiceCatalogEntry,
  routes: readonly VoiceRouteLike[],
  t: (key: string, params?: Record<string, string>) => string
): string[] => {
  const text = t('voiceCommands.textPlaceholder')
  if (isTranslateEntry(entry)) {
    const language = t('voiceCommands.languagePlaceholder')
    return grammarVariants(rawGrammar(t, 'voiceGrammar.translate'))
      .slice(0, 1)
      .map((template) =>
        LANGUAGE_SLOT.test(template)
          ? `${template.replace(LANGUAGE_SLOT, language)} ${text}`
          : `${template} ${language} ${text}`
      )
  }
  if (entry.group === 'builtIn')
    return grammarVariants(rawGrammar(t, 'voiceGrammar.actions.askInChat'))
      .slice(0, 1)
      .map((phrase) => `${phrase} ${text}`)
  return [
    ...new Set(
      routes
        .filter((route) => route.commandId === entry.key)
        .map((route) =>
          [
            route.phrase,
            ...route.parameters.map((parameter) =>
              parameter.variants.join(' / ')
            ),
          ].join(' ')
        )
    ),
  ]
}

/** Errors the app describes itself come as message keys, see the model */
const MESSAGE_KEY = /^(?:voiceCommands|toast)\.[\w.]+$/u

export function resolveVoiceNotice(
  state: {
    error: string
    command: CommandConfig | undefined
    unavailableReason: (command: CommandConfig) => string | undefined
    inputIssue: 'missing-text' | 'extra-text' | undefined
    stage: string
    resolutionKind: VoiceResolution['kind']
  },
  t: (key: string) => string
): VoiceNotice | undefined {
  if (state.error) {
    const key = state.error
    return { kind: 'error', message: MESSAGE_KEY.test(key) ? t(key) : key }
  }
  if (state.command) {
    const reason = state.unavailableReason(state.command)
    if (reason) return { kind: 'warning', message: t(reason) }
    if (state.inputIssue)
      return {
        kind: 'warning',
        message:
          state.inputIssue === 'missing-text'
            ? t('voiceCommands.missingText')
            : t('voiceCommands.extraText'),
      }
    return undefined
  }
  if (state.stage !== 'review') return undefined
  if (state.resolutionKind === 'ambiguous')
    return { kind: 'info', message: t('voiceCommands.ambiguous') }
  if (state.resolutionKind === 'parameter-error')
    return { kind: 'info', message: t('voiceCommands.languageMissing') }
  return { kind: 'info', message: t('voiceCommands.noMatch') }
}

/** A row picked by hand takes the recognized parameters when it has them */
export function pickVoiceCatalogEntry(
  entry: VoiceCatalogEntry,
  deps: {
    canPick: (entry: VoiceCatalogEntry) => boolean
    marks: ReadonlyMap<string, VoiceCandidate>
    selected: VoiceCandidate | undefined
    choose: (candidate: VoiceCandidate) => void
    chooseCommand: (commandId: string) => void
  }
): boolean {
  if (!deps.canPick(entry)) return false
  const candidate = deps.marks.get(entry.key)
  if (candidate && candidate !== deps.selected) deps.choose(candidate)
  else if (!candidate) deps.chooseCommand(entry.commands[0]!.id)
  return true
}
