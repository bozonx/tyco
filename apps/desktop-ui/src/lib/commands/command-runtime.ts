import {
  CORE_TOOL_IDS,
  type CoreOperationId,
  sampleUrlTemplate,
  type CommandConfig,
  type CommandRunSource,
} from '@tyco/shared'
import { errorMessage } from '@tyco/shared/value-guards'
import { translate } from '../i18n'
import type { Invocation, ResultSink } from '../invocation/invocation-types'
import { invocationUnavailableReason } from '../invocation/invoke-operation'
import { resolveSink } from '../invocation/result-sinks'
import { openCommandParameters } from '../operations/command-parameters'
import {
  operationCallConfig,
  operationInputKind,
} from '../operations/operation-input'
import type {
  RegisteredOperation,
  OperationInputKind,
  OperationLookup,
} from '../operations/operation-types'
import { httpOrigin } from '../net/secrets'
import { outputRequest } from '../operations/operation-call'
import {
  scriptOperationConfig,
  stringOr,
  webhookOperationConfig,
} from './command-config'

/** Output handling belongs to the invocation context, not the tool. */
export function commandAfterRun(
  command: CommandConfig,
  source: CommandRunSource = 'menu'
): ResultSink {
  return resolveSink(commandInvocation(command), { source })
}

const isCoreOperationId = (
  operationId: string
): operationId is CoreOperationId =>
  CORE_TOOL_IDS.includes(operationId as CoreOperationId)

/** The tool the command runs, if the registry has it */
export const commandOperation = (
  command: CommandConfig,
  operations: OperationLookup
): RegisteredOperation | undefined => operations.get(command.operationId)

/**
 * How the command gets its input from a text, or `null` when its tool is
 * missing or it cannot get one outside the chat
 */
function commandInputKind(
  command: CommandConfig,
  operations: OperationLookup
): OperationInputKind | null {
  const tool = commandOperation(command, operations)
  return tool
    ? operationInputKind(
        tool,
        operationCallConfig(tool, command.operationConfig),
        command.isLlmArgumentParsingEnabled
      )
    : null
}

/**
 * Why the command cannot run now, as an i18n key: no such tool, the tool is not
 * available, or the command cannot get its input from a text
 */
export const commandUnavailableReason = (
  command: CommandConfig,
  operations: OperationLookup
): string | undefined =>
  invocationUnavailableReason(commandInvocation(command), operations)

/** Whether the tool of the command can run it now */
export const isCommandAvailable = (
  command: CommandConfig,
  operations: OperationLookup
): boolean => !commandUnavailableReason(command, operations)

/** Whether the command gets the text it is invoked on */
export function commandTakesText(
  command: CommandConfig,
  operations: OperationLookup
): boolean {
  const kind = commandInputKind(command, operations)
  return kind === 'text' || kind === 'parsed'
}

/** Whether the command can be an item of the action menu */
export function isMenuCommand(
  command: CommandConfig,
  operations: OperationLookup
): boolean {
  return !menuCommandUnavailableReason(command, operations)
}

export function menuCommandUnavailableReason(
  command: CommandConfig,
  operations: OperationLookup
): string | undefined {
  if (!command.isEnabled) return 'toast.commandDisabled'
  const unavailable = commandUnavailableReason(command, operations)
  if (unavailable) return unavailable
  const tool = commandOperation(command, operations)
  if (
    tool &&
    openCommandParameters(
      tool,
      operationCallConfig(tool, command.operationConfig)
    ).length
  ) {
    return command.operationId === 'core.translate'
      ? 'commands.errorNoLanguage'
      : 'commands.inputUnsupported'
  }
  return validateCommand(command, operations).find(
    (issue) => issue.field !== 'name' && !issue.isWarning
  )?.messageKey
}

export function commandIcon(
  command: CommandConfig,
  operations: OperationLookup
): string {
  return commandOperation(command, operations)?.icon ?? 'mdi:puzzle-outline'
}

/** The last part of a path, without quotes */
const baseName = (path: string): string =>
  path
    .replace(/^['"]|['"]$/g, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) ?? ''

/**
 * A name for a command that has none, from what it runs: the program of a
 * script, the host of a webhook; empty when there is nothing to take it from
 */
export function suggestCommandName(command: CommandConfig): string {
  if (command.operationId === 'script') {
    const line = scriptOperationConfig(command).command.trim()
    const program = line.match(/^(['"])(.*?)\1|^\S+/)
    return program ? baseName(program[2] ?? program[0]) : ''
  }
  if (command.operationId === 'webhook') {
    try {
      return new URL(webhookOperationConfig(command).url.trim()).hostname
    } catch {
      return ''
    }
  }
  return ''
}

/** The longest shell command shown in place of a name */
const SCRIPT_LABEL_MAX_CHARS = 60

/**
 * The first line of a shell command, cut short: a label goes to overlays,
 * notifications and the log, and a long script may hold more than its name
 */
function shortScriptLabel(script: string): string {
  const line = script.trim().split(/\r?\n/, 1)[0]?.trim() ?? ''
  const isCut = line.length > SCRIPT_LABEL_MAX_CHARS || line !== script.trim()
  return isCut ? `${line.slice(0, SCRIPT_LABEL_MAX_CHARS).trimEnd()}…` : line
}

/**
 * The name shown for the command, never empty. Without a name of its own it is
 * named by what it runs: a command of a core tool by the name of the tool
 */
export function commandLabel(command: CommandConfig): string {
  if (command.name.trim()) return command.name
  if (isCoreOperationId(command.operationId))
    return translate(`operations.${command.operationId.slice('core.'.length)}`)
  if (command.operationId === 'script') {
    return (
      shortScriptLabel(scriptOperationConfig(command).command) || command.id
    )
  }
  if (command.operationId === 'webhook') {
    return (
      suggestCommandName(command) ||
      webhookOperationConfig(command).url.trim() ||
      command.id
    )
  }
  // the tool says more than the generated id of the command
  return command.operationId.trim() || command.id
}

/** The invocation that runs the command */
export function commandInvocation(command: CommandConfig): Invocation {
  return {
    operationId: command.operationId,
    operationConfig: command.operationConfig,
    label: commandLabel(command),
    commandId: command.id,
    isLlmArgumentParsingEnabled: command.isLlmArgumentParsingEnabled,
    isOutputLogged: command.isOutputLogged,
    outputAction: command.outputAction,
    ...(command.platforms?.length ? { platforms: command.platforms } : {}),
  }
}

/**
 * What the command runs, shown before it does: the shell command of a script,
 * the method and URL of a webhook
 */
export function commandTarget(command: CommandConfig): string {
  if (command.operationId === 'script')
    return scriptOperationConfig(command).command
  if (command.operationId === 'webhook') {
    const config = webhookOperationConfig(command)
    return `${config.method} ${config.url}`
  }
  return ''
}

export interface CommandIssue {
  /** The tool config field the issue is about */
  field: string
  messageKey: string
  /** The command runs anyway, though maybe not as the user expects */
  isWarning?: boolean
}

/** What keeps the command from running as the user expects */
export function validateCommand(
  command: CommandConfig,
  operations: OperationLookup
): CommandIssue[] {
  const issues: CommandIssue[] = []
  if (!command.name.trim()) {
    issues.push({ field: 'name', messageKey: 'commands.errorNoName' })
  }
  if (
    command.operationId !== 'core.aiTask' &&
    command.isLlmPreTransformEnabled &&
    commandTakesText(command, operations) &&
    !stringOr(command.llmPreTransformPrompt).trim()
  ) {
    issues.push({
      field: 'llmPreTransformPrompt',
      messageKey: 'commands.errorNoPrompt',
    })
  }
  if (command.operationId === 'script') {
    const config = scriptOperationConfig(command)
    if (!config.command.trim()) {
      issues.push({ field: 'command', messageKey: 'commands.errorNoCommand' })
    }
  } else if (command.operationId === 'webhook') {
    const config = webhookOperationConfig(command)
    if (!config.url.trim()) {
      issues.push({ field: 'url', messageKey: 'commands.errorNoUrl' })
    } else if (!httpOrigin(sampleUrlTemplate(config.url))) {
      issues.push({ field: 'url', messageKey: 'commands.errorInvalidUrl' })
    }
  } else if (
    command.operationId === 'core.aiTask' ||
    command.operationId === 'core.transformation' ||
    command.operationId === 'core.styling'
  ) {
    if (!stringOr(command.operationConfig.prompt).trim()) {
      issues.push({ field: 'prompt', messageKey: 'commands.errorNoPrompt' })
    }
  } else if (!commandOperation(command, operations)) {
    issues.push({
      field: 'operationId',
      messageKey: 'commands.errorUnknownType',
    })
  }
  return issues
}

export interface PreTransformResult {
  ok: boolean
  text?: string
  cancelled?: boolean
  messageKey?: string
  message?: string
}

/** Shown when the LLM prepared no text for the command */
const PRE_TRANSFORM_EMPTY_KEY = 'commands.preTransformEmpty'

/**
 * Pre-transforms the text using LLM if the command has pre-transformation
 * enabled and takes the text: a command that does not would only send it to the
 * LLM for nothing. An empty result is a failure, not a text to run on
 */
export async function preTransformCommandText(
  command: CommandConfig,
  text: string,
  operations: OperationLookup,
  options: {
    signal?: AbortSignal
    source?: CommandRunSource
    transformTextWithLlm?: (
      prompt: string,
      text: string,
      options?: { signal?: AbortSignal }
    ) => Promise<string>
  } = {}
): Promise<PreTransformResult> {
  if (
    !command.isLlmPreTransformEnabled ||
    command.operationId === 'core.aiTask' ||
    !commandTakesText(command, operations)
  ) {
    return { ok: true, text }
  }
  const prompt = stringOr(command.llmPreTransformPrompt).trim()
  if (!prompt) {
    return { ok: false, messageKey: 'commands.errorNoPrompt' }
  }
  if (!text.trim()) {
    return { ok: true, text }
  }
  if (options.signal?.aborted) {
    return { ok: false, cancelled: true }
  }
  if (options.transformTextWithLlm) {
    try {
      const result = await options.transformTextWithLlm(prompt, text, {
        signal: options.signal,
      })
      if (options.signal?.aborted) return { ok: false, cancelled: true }
      if (!result.trim())
        return { ok: false, messageKey: PRE_TRANSFORM_EMPTY_KEY }
      return { ok: true, text: result }
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, cancelled: true }
      return { ok: false, message: errorMessage(error) }
    }
  }
  const tool = operations.get('core.transformation')
  if (!tool) {
    return { ok: false, messageKey: 'commands.typeMissing' }
  }
  const reason = tool.getUnavailableReasonKey?.()
  if (reason) {
    return { ok: false, messageKey: reason }
  }
  try {
    const res = await tool.run({
      input: { text },
      config: { prompt },
      source: options.source ?? 'menu',
      signal: options.signal ?? new AbortController().signal,
      ...outputRequest(true),
    })
    if (res.cancelled || options.signal?.aborted) {
      return { ok: false, cancelled: true }
    }
    if (!res.ok) {
      return { ok: false, messageKey: res.messageKey, message: res.message }
    }
    if (!res.content?.trim()) {
      return { ok: false, messageKey: PRE_TRANSFORM_EMPTY_KEY }
    }
    return { ok: true, text: res.content }
  } catch (error) {
    if (options.signal?.aborted) return { ok: false, cancelled: true }
    return { ok: false, message: errorMessage(error) }
  }
}
