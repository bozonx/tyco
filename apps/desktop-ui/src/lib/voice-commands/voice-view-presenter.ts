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
  operations: OperationLookup
): readonly OperationCommandParameter[] =>
  openCommandParameters(
    operations.get(command.operationId),
    command.operationConfig
  )

export const parameterDisplayLabel = (
  parameter: OperationCommandParameter,
  t: Translate
): string =>
  parameter.labelKey
    ? t(parameter.labelKey)
    : (parameter.label ?? parameter.name)

export const parameterValueDisplayLabel = (
  parameter: OperationCommandParameter,
  value: string,
  t: Translate
): string => {
  if (parameter.valueLabelKey) return t(parameter.valueLabelKey(value))
  const opt = parameter.options?.find((item) => item.value === value)
  if (opt?.labelKey) return t(opt.labelKey)
  if (opt?.label) return opt.label
  return value
}

/** The values a parameter can take, to pick one by hand */
export const voiceParameterOptions = (
  parameter: OperationCommandParameter,
  t: Translate
): { id: string; name: string }[] =>
  parameterValues(parameter).map((value) => ({
    id: value,
    name: parameterValueDisplayLabel(parameter, value, t),
  }))

/** The named values of the parameters of the command, as they are shown */
export const voiceParameterLabels = (
  command: CommandConfig,
  parameters: Readonly<Record<string, string>>,
  operations: OperationLookup,
  t: Translate
): string[] =>
  voiceParameters(command, operations).flatMap((parameter) => {
    const value = parameters[parameter.name]
    return value ? [parameterValueDisplayLabel(parameter, value, t)] : []
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
  operations: OperationLookup,
  t: Translate
): string[] => {
  const own = command.phrases.map((phrase) => phrase.trim()).filter(Boolean)
  const [parameter] = voiceParameters(command, operations)
  if (!parameter) return [...new Set(own)]
  const slot = `{${parameter.name}}`
  const key = operations.get(command.operationId)?.voicePhrasesKey
  const templates = own.length
    ? own
    : key
      ? grammarVariants(rawMessage(t, key, parameter.name)).slice(0, 1)
      : []
  const placeholder = parameter.placeholderKey
    ? t(parameter.placeholderKey)
    : (parameter.placeholder ?? parameter.name)
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
    candidates?: readonly VoiceCandidate[]
    /** The parameter whose spoken value is not recognized */
    failedParameter?: OperationCommandParameter
  },
  t: Translate
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
  if (state.resolutionKind === 'ambiguous') {
    const sameCommand =
      Boolean(state.candidates?.length) &&
      state.candidates!.every(
        (c) => c.commandId === state.candidates![0]!.commandId
      )
    return {
      kind: 'info',
      message: sameCommand
        ? t('voiceCommands.parameterMissing')
        : t('voiceCommands.ambiguous'),
    }
  }
  if (state.resolutionKind === 'parameter-error')
    return { kind: 'info', message: parameterErrorMessage(state, t) }
  return { kind: 'info', message: t('voiceCommands.noMatch') }
}

function parameterErrorMessage(
  state: { failedParameter?: OperationCommandParameter },
  t: Translate
): string {
  const parameter = state.failedParameter
  if (parameter?.voiceErrorKey) return t(parameter.voiceErrorKey)
  return t('voiceCommands.parameterUnrecognized', {
    parameter: parameter
      ? parameterDisplayLabel(parameter, t)
      : t('voiceCommands.parameterFallbackLabel'),
  })
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
