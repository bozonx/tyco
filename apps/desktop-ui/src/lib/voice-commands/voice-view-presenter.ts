import type { CommandConfig } from '@tyco/shared'

import {
  openCommandParameters,
  parameterValues,
} from '../operations/command-parameters'
import type {
  OperationCommandParameter,
  OperationLookup,
} from '../operations/operation-types'
import {
  grammarVariants,
  type VoiceCandidate,
  type VoiceInputIssue,
  type VoiceResolution,
} from './voice-resolver'

type Translate = (key: string, params?: Record<string, string>) => string

export interface VoiceNotice {
  kind: 'info' | 'warning' | 'error'
  message: string
}

/** The parameters the phrase of the command names, see `commandParameters` */
export const voiceParameters = (
  command: CommandConfig,
  tools: OperationLookup
): readonly OperationCommandParameter[] =>
  openCommandParameters(tools.get(command.operationId), command.operationConfig)

/** The values a parameter can take, to pick one by hand */
export const voiceParameterOptions = (
  parameter: OperationCommandParameter,
  t: Translate
): { id: string; name: string }[] =>
  parameterValues(parameter).map((value) => ({
    id: value,
    name: t(parameter.valueLabelKey(value)),
  }))

/** The named values of the parameters of the command, as they are shown */
export const voiceParameterLabels = (
  command: CommandConfig,
  parameters: Readonly<Record<string, string>>,
  tools: OperationLookup,
  t: Translate
): string[] =>
  voiceParameters(command, tools).flatMap((parameter) => {
    const value = parameters[parameter.name]
    return value ? [t(parameter.valueLabelKey(value))] : []
  })

/**
 * A message as written: `t` would interpolate its slot. The slot is passed back
 * to itself to keep it.
 */
const rawMessage = (t: Translate, key: string, name: string) =>
  t(key, { [name]: `{${name}}` })

/**
 * How the command is spoken, as samples: its phrases, or the first phrase of
 * its tool in the UI language, with the parameter and the text shown as
 * placeholders
 */
export const voiceCommandPhrases = (
  command: CommandConfig,
  tools: OperationLookup,
  t: Translate
): string[] => {
  const own = command.phrases.map((phrase) => phrase.trim()).filter(Boolean)
  const [parameter] = voiceParameters(command, tools)
  if (!parameter) return [...new Set(own)]
  const slot = `{${parameter.name}}`
  const key = tools.get(command.operationId)?.voicePhrasesKey
  const templates = own.length
    ? own
    : key
      ? grammarVariants(rawMessage(t, key, parameter.name)).slice(0, 1)
      : []
  const placeholder = t(parameter.placeholderKey)
  const text = t('voiceCommands.textPlaceholder')
  return [
    ...new Set(
      templates.map((template) =>
        template.includes(slot)
          ? `${template.replace(slot, placeholder)} ${text}`
          : `${template} ${placeholder} ${text}`
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
    inputIssue: VoiceInputIssue | undefined
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
            : state.inputIssue === 'missing-selection'
              ? t('voiceCommands.missingSelection')
              : state.inputIssue === 'missing-parameter'
                ? t('voiceCommands.parameterMissing')
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

/** A command picked by hand takes the recognized parameters when it has them */
export function pickVoiceCommand(
  command: CommandConfig,
  deps: {
    canPick: (command: CommandConfig) => boolean
    marks: ReadonlyMap<string, VoiceCandidate>
    selected: VoiceCandidate | undefined
    choose: (candidate: VoiceCandidate) => void
    chooseCommand: (commandId: string) => void
  }
): boolean {
  if (!deps.canPick(command)) return false
  const candidate = deps.marks.get(command.id)
  if (candidate && candidate !== deps.selected) deps.choose(candidate)
  else if (!candidate) deps.chooseCommand(command.id)
  return true
}
