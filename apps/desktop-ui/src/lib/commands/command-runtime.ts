import type { CommandConfig, CommandRunSource } from '@tyco/shared'
import { errorMessage } from '@tyco/shared/value-guards'
import type { Invocation, ResultSink } from '../invocation/invocation-types'
import { invocationUnavailableReason } from '../invocation/invoke-tool'
import { resolveSink } from '../invocation/result-sinks'
import { toolInputKind } from '../tools/tool-input'
import type {
  RegisteredTool,
  ToolInputKind,
  ToolLookup,
} from '../tools/tool-types'
import { scriptToolConfig, webhookToolConfig } from './command-config'

/** Output handling belongs to the invocation context, not the tool. */
export function commandAfterRun(
  command: CommandConfig,
  source: CommandRunSource = 'menu'
): ResultSink {
  return resolveSink(commandInvocation(command), { source })
}

/** The tool the command runs, if the registry has it */
export const commandTool = (
  command: CommandConfig,
  tools: ToolLookup
): RegisteredTool | undefined => tools.get(command.toolId)

/**
 * How the command gets its input from a text, or `null` when its tool is
 * missing or it cannot get one outside the chat
 */
function commandInputKind(
  command: CommandConfig,
  tools: ToolLookup
): ToolInputKind | null {
  const tool = commandTool(command, tools)
  return tool
    ? toolInputKind(
        tool,
        command.toolConfig,
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
  tools: ToolLookup
): string | undefined =>
  invocationUnavailableReason(commandInvocation(command), tools)

/** Whether the tool of the command can run it now */
export const isCommandAvailable = (
  command: CommandConfig,
  tools: ToolLookup
): boolean => !commandUnavailableReason(command, tools)

/** Whether the command gets the text it is invoked on */
export function commandTakesText(
  command: CommandConfig,
  tools: ToolLookup
): boolean {
  const kind = commandInputKind(command, tools)
  return kind === 'text' || kind === 'parsed'
}

/** Whether the command can be an item of the action menu */
export function isMenuCommand(
  command: CommandConfig,
  tools: ToolLookup
): boolean {
  return command.isEnabled && isCommandAvailable(command, tools)
}

export function commandIcon(command: CommandConfig, tools: ToolLookup): string {
  return commandTool(command, tools)?.icon ?? 'mdi:puzzle-outline'
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
  if (command.toolId === 'script') {
    const line = scriptToolConfig(command).command.trim()
    const program = line.match(/^(['"])(.*?)\1|^\S+/)
    return program ? baseName(program[2] ?? program[0]) : ''
  }
  if (command.toolId === 'webhook') {
    try {
      return new URL(webhookToolConfig(command).url.trim()).hostname
    } catch {
      return ''
    }
  }
  return ''
}

/** The name shown for the command, never empty */
export function commandLabel(command: CommandConfig): string {
  if (command.name.trim()) return command.name
  if (command.toolId === 'script') {
    return scriptToolConfig(command).command.trim() || 'Command'
  }
  if (command.toolId === 'webhook') return 'Webhook'
  return command.id
}

/** The invocation that runs the command */
export function commandInvocation(command: CommandConfig): Invocation {
  return {
    toolId: command.toolId,
    toolConfig: command.toolConfig,
    label: commandLabel(command),
    commandId: command.id,
    isLlmArgumentParsingEnabled: command.isLlmArgumentParsingEnabled,
    isOutputLogged: command.isOutputLogged,
    outputAction: command.outputAction,
  }
}

/**
 * What the command runs, shown before it does: the shell command of a script,
 * the method and URL of a webhook
 */
export function commandTarget(command: CommandConfig): string {
  if (command.toolId === 'script') return scriptToolConfig(command).command
  if (command.toolId === 'webhook') {
    const config = webhookToolConfig(command)
    return `${config.method ?? 'POST'} ${config.url}`
  }
  return ''
}

const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

export interface CommandIssue {
  /** The tool config field the issue is about */
  field: string
  messageKey: string
}

/** What keeps the command from running as the user expects */
export function validateCommand(
  command: CommandConfig,
  tools: ToolLookup
): CommandIssue[] {
  const issues: CommandIssue[] = []
  if (!command.name.trim()) {
    issues.push({ field: 'name', messageKey: 'commands.errorNoName' })
  }
  if (
    command.isLlmPreTransformEnabled &&
    !stringOr(command.llmPreTransformPrompt).trim()
  ) {
    issues.push({
      field: 'llmPreTransformPrompt',
      messageKey: 'commands.errorNoPrompt',
    })
  }
  if (command.toolId === 'script') {
    const config = scriptToolConfig(command)
    if (!config.command.trim()) {
      issues.push({ field: 'command', messageKey: 'commands.errorNoCommand' })
    }
  } else if (command.toolId === 'webhook') {
    const config = webhookToolConfig(command)
    if (!config.url.trim()) {
      issues.push({ field: 'url', messageKey: 'commands.errorNoUrl' })
    }
  } else if (command.toolId === 'core.translate') {
    if (!stringOr(command.toolConfig.language).trim()) {
      issues.push({ field: 'language', messageKey: 'commands.errorNoLanguage' })
    }
  } else if (
    command.toolId === 'core.aiTask' ||
    command.toolId === 'core.transformation' ||
    command.toolId === 'core.styling'
  ) {
    if (!stringOr(command.toolConfig.prompt).trim()) {
      issues.push({ field: 'prompt', messageKey: 'commands.errorNoPrompt' })
    }
  } else if (!commandTool(command, tools)) {
    issues.push({ field: 'toolId', messageKey: 'commands.errorUnknownTool' })
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

/**
 * Pre-transforms the text using LLM if the command has pre-transformation
 * enabled.
 */
export async function preTransformCommandText(
  command: CommandConfig,
  text: string,
  tools: ToolLookup,
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
  if (!command.isLlmPreTransformEnabled) {
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
      return { ok: true, text: result }
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, cancelled: true }
      return { ok: false, message: errorMessage(error) }
    }
  }
  const tool = tools.get('core.transformation')
  if (!tool) {
    return { ok: false, messageKey: 'commands.toolMissing' }
  }
  const reason = tool.getUnavailableReasonKey?.()
  if (reason) {
    return { ok: false, messageKey: reason }
  }
  const res = await tool.run({
    input: { text },
    config: { prompt },
    source: options.source ?? 'menu',
    signal: options.signal ?? new AbortController().signal,
    isOutputRequested: true,
    wantsOutput: true,
  })
  if (res.cancelled || options.signal?.aborted) {
    return { ok: false, cancelled: true }
  }
  if (!res.ok) {
    return { ok: false, messageKey: res.messageKey, message: res.message }
  }
  return { ok: true, text: res.content ?? text }
}
