import {
  ACTION_TEXT_PLACEHOLDER,
  COMMAND_CONFIRM_MODES,
  CUSTOM_ACTION_AFTER_RUN,
  type CommandConfig,
  type CommandConfirmMode,
  type CustomActionAfterRun,
  type MainActionConfig,
  type ScriptToolConfig,
  type WebhookToolConfig,
} from '@tyco/shared'

import { normalizeShortcutSlots } from '../shortcut-slots/shortcut-slots'
import { toolInputKind } from '../tools/tool-input'
import type {
  RegisteredTool,
  ToolInputKind,
  ToolLookup,
} from '../tools/tool-types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const afterRunOf = (value: unknown): CustomActionAfterRun =>
  CUSTOM_ACTION_AFTER_RUN.includes(value as CustomActionAfterRun)
    ? (value as CustomActionAfterRun)
    : 'none'

const confirmOf = (value: unknown): CommandConfirmMode =>
  COMMAND_CONFIRM_MODES.includes(value as CommandConfirmMode)
    ? (value as CommandConfirmMode)
    : 'auto'

function headersOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

export function scriptToolConfigOf(
  config: Record<string, unknown>
): ScriptToolConfig {
  return {
    command: stringOr(config.command),
    workingDir: stringOr(config.workingDir),
    takesText: config.takesText !== false,
  }
}

export function webhookToolConfigOf(
  config: Record<string, unknown>
): WebhookToolConfig {
  return {
    url: stringOr(config.url),
    method: config.method === 'GET' ? 'GET' : 'POST',
    headers: headersOf(config.headers),
    payloadTemplate: stringOr(config.payloadTemplate),
    authSecret: Boolean(config.authSecret),
    takesText: config.takesText !== false,
  }
}

export const scriptToolConfig = (command: CommandConfig): ScriptToolConfig =>
  scriptToolConfigOf(command.toolConfig)

export const webhookToolConfig = (command: CommandConfig): WebhookToolConfig =>
  webhookToolConfigOf(command.toolConfig)

const normalizeToolConfig = (
  toolId: string,
  command: CommandConfig
): Record<string, unknown> => {
  if (toolId === 'script') return { ...scriptToolConfig(command) }
  if (toolId === 'webhook') return { ...webhookToolConfig(command) }
  // the settings of a tool this build does not know are kept as they are
  return command.toolConfig
}

/** A command read from the config, or `null` when it has no id or tool */
export function normalizeCommand(value: unknown): CommandConfig | null {
  if (!isRecord(value)) return null
  const id = stringOr(value.id).trim()
  const toolId = stringOr(value.toolId).trim()
  if (!id || !toolId) return null

  const availableIn = isRecord(value.availableIn) ? value.availableIn : {}
  const command: CommandConfig = {
    id,
    name: stringOr(value.name),
    phrases: Array.isArray(value.phrases)
      ? value.phrases.filter((item): item is string => typeof item === 'string')
      : [],
    toolId,
    toolConfig: isRecord(value.toolConfig) ? value.toolConfig : {},
    llmArgumentParsing: value.llmArgumentParsing === true,
    afterRun: afterRunOf(value.afterRun),
    logOutput: value.logOutput === true,
    confirm: confirmOf(value.confirm),
    availableIn: {
      external: availableIn.external === true,
      chat: availableIn.chat === true,
    },
    enabled: value.enabled !== false,
  }
  if (typeof value.description === 'string' && value.description) {
    command.description = value.description
  }
  command.toolConfig = normalizeToolConfig(toolId, command)
  return command
}

/** The command library from the config; a repeated id keeps the first one */
export function normalizeCommands(value: unknown): CommandConfig[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const command = normalizeCommand(item)
    if (!command || seen.has(command.id)) return []
    seen.add(command.id)
    return [command]
  })
}

/**
 * Normalizes the 15 slots of the command overlay. Migrates from legacy
 * `availableIn.launcher` when `value` is not an array.
 */
export function normalizeLauncherCommands(
  value: unknown,
  commands: readonly CommandConfig[] = []
): (string | null)[] {
  let source: readonly unknown[] | undefined
  if (Array.isArray(value)) {
    source = value
  } else {
    // Migration: populate slots with commands that had legacy `availableIn.launcher`
    const rawCommands = commands as (CommandConfig & {
      availableIn?: { launcher?: boolean }
    })[]
    source = rawCommands.filter((c) => c.availableIn?.launcher).map((c) => c.id)
  }
  const existingIds = new Set(commands.map((c) => c.id))
  return normalizeShortcutSlots<string>(
    source.map((item) =>
      typeof item === 'string' && item.trim() ? item : null
    )
  ).map((id) => (id && existingIds.has(id) ? id : null))
}

export function newCommandId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `command-${Date.now()}`
}

/** The settings a new command of the tool starts with */
function defaultToolConfig(toolId: string): Record<string, unknown> {
  switch (toolId) {
    case 'script':
      return { command: '', workingDir: '', takesText: true }
    case 'webhook':
      return {
        url: '',
        method: 'POST',
        headers: {},
        payloadTemplate: '',
        authSecret: false,
        takesText: true,
      }
    case 'core.translate':
      return { language: '' }
    case 'core.aiTask':
      return { prompt: '' }
    default:
      // a plugin tool falls back to the plugin settings for empty fields
      return {}
  }
}

/**
 * A new command of the library with the defaults for its tool; `tool` gives
 * what to do with the output of a tool that returns a text
 */
export function createCommand(
  toolId: string,
  id: string = newCommandId(),
  tool?: Pick<RegisteredTool, 'defaultAfterRun'>
): CommandConfig {
  return {
    id,
    name: '',
    phrases: [],
    toolId,
    toolConfig: defaultToolConfig(toolId),
    llmArgumentParsing: false,
    afterRun: tool?.defaultAfterRun ?? 'none',
    logOutput: false,
    // a script runs with the rights of the user and cannot be undone
    confirm: toolId === 'script' ? 'always' : 'auto',
    availableIn: { external: false, chat: false },
    enabled: true,
  }
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
export function commandInputKind(
  command: CommandConfig,
  tools: ToolLookup
): ToolInputKind | null {
  const tool = commandTool(command, tools)
  return tool
    ? toolInputKind(tool, command.toolConfig, command.llmArgumentParsing)
    : null
}

/**
 * Why the command cannot run now, as an i18n key: no such tool, the tool is not
 * available, or the command cannot get its input from a text
 */
export function commandUnavailableReason(
  command: CommandConfig,
  tools: ToolLookup
): string | undefined {
  const tool = commandTool(command, tools)
  if (!tool) return 'commands.toolMissing'
  const reason = tool.unavailableReason?.()
  if (reason) return reason
  if (commandInputKind(command, tools) === null) {
    return 'commands.inputUnsupported'
  }
  return undefined
}

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
  return (
    command.enabled &&
    isCommandAvailable(command, tools) &&
    commandTakesText(command, tools)
  )
}

export function commandIcon(command: CommandConfig, tools: ToolLookup): string {
  return commandTool(command, tools)?.icon ?? 'mdi:puzzle-outline'
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

/**
 * A name as external calls compare it: case, `ё` and spaces do not matter. Keep
 * in sync with `normalize_name` in `services/external_commands.rs`
 */
export function normalizeCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/** Whether an external call may run the command */
export function isExternalCommand(
  command: CommandConfig,
  tools: ToolLookup
): boolean {
  return (
    command.enabled &&
    command.availableIn.external &&
    isCommandAvailable(command, tools)
  )
}

/**
 * The other commands an external call by the name of `command` could mean as
 * well: such a call is refused as ambiguous
 */
export function externalNameTwins(
  commands: readonly CommandConfig[],
  command: CommandConfig,
  tools: ToolLookup
): CommandConfig[] {
  const name = normalizeCommandName(command.name)
  if (!name || !isExternalCommand(command, tools)) return []
  return commands.filter(
    (other) =>
      other.id !== command.id &&
      isExternalCommand(other, tools) &&
      normalizeCommandName(other.name) === name
  )
}

export interface CommandIssue {
  /** The tool config field the issue is about */
  field: string
  messageKey: string
}

const hasPlaceholder = (value: string | undefined): boolean =>
  Boolean(value?.includes(ACTION_TEXT_PLACEHOLDER))

/** What keeps the command from running as the user expects */
export function validateCommand(
  command: CommandConfig,
  tools: ToolLookup
): CommandIssue[] {
  const issues: CommandIssue[] = []
  if (command.toolId === 'script') {
    const config = scriptToolConfig(command)
    if (!config.command.trim()) {
      issues.push({ field: 'command', messageKey: 'commands.errorNoCommand' })
    }
    if (!config.takesText && hasPlaceholder(config.command)) {
      issues.push({
        field: 'command',
        messageKey: 'commands.errorTextPlaceholder',
      })
    }
  } else if (command.toolId === 'webhook') {
    const config = webhookToolConfig(command)
    if (!config.url.trim()) {
      issues.push({ field: 'url', messageKey: 'commands.errorNoUrl' })
    }
    if (!config.takesText) {
      if (hasPlaceholder(config.url)) {
        issues.push({
          field: 'url',
          messageKey: 'commands.errorTextPlaceholder',
        })
      }
      if (config.method === 'POST' && hasPlaceholder(config.payloadTemplate)) {
        issues.push({
          field: 'payloadTemplate',
          messageKey: 'commands.errorTextPlaceholder',
        })
      }
    }
  } else if (command.toolId === 'core.translate') {
    if (!stringOr(command.toolConfig.language).trim()) {
      issues.push({ field: 'language', messageKey: 'commands.errorNoLanguage' })
    }
  } else if (command.toolId === 'core.aiTask') {
    if (!stringOr(command.toolConfig.prompt).trim()) {
      issues.push({ field: 'prompt', messageKey: 'commands.errorNoPrompt' })
    }
  } else if (!commandTool(command, tools)) {
    issues.push({ field: 'toolId', messageKey: 'commands.errorUnknownTool' })
  }
  return issues
}

/** The menu without the items that refer to the command */
export function removeCommandReferences(
  slots: readonly (MainActionConfig | null)[],
  commandId: string
): (MainActionConfig | null)[] {
  return slots.map((slot) =>
    slot?.type === 'command' && slot.commandId === commandId ? null : slot
  )
}
