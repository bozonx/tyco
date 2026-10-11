import {
  CUSTOM_ACTION_AFTER_RUN,
  type CommandConfig,
  type CommandLauncherAfterRun,
  type CommandRunSource,
  type CustomActionAfterRun,
  type MainActionConfig,
  SCRIPT_MAX_TIMEOUT_SEC,
  type ScriptToolConfig,
  type WebhookToolConfig,
} from '@tyco/shared'

import type { Invocation, ResultSink } from '../invocation/invocation-types'
import { invocationUnavailableReason } from '../invocation/invoke-tool'
import { resolveSink } from '../invocation/result-sinks'
import { normalizeShortcutSlots } from '../shortcut-slots/shortcut-slots'
import { toolInputKind } from '../tools/tool-input'
import type {
  RegisteredTool,
  ToolInputKind,
  ToolLookup,
  ToolOwner,
} from '../tools/tool-types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const afterRunOf = (value: unknown): CustomActionAfterRun =>
  CUSTOM_ACTION_AFTER_RUN.includes(value as CustomActionAfterRun)
    ? (value as CustomActionAfterRun)
    : 'none'

/** Preserves legacy output settings in the two quick-command contexts. */
export function launcherAfterRunFromLegacy(
  value: unknown
): CommandLauncherAfterRun {
  const afterRun = afterRunOf(value)
  return {
    withSelection: afterRun,
    withoutSelection: afterRun === 'replaceSelection' ? 'showMenu' : afterRun,
  }
}

function normalizeLauncherAfterRun(
  value: unknown,
  legacy: unknown
): CommandLauncherAfterRun {
  const defaults = launcherAfterRunFromLegacy(legacy)
  if (!isRecord(value)) return defaults
  const withSelection =
    value.withSelection === undefined
      ? defaults.withSelection
      : afterRunOf(value.withSelection)
  const withoutSelection =
    value.withoutSelection === undefined
      ? defaults.withoutSelection
      : afterRunOf(value.withoutSelection)
  return {
    withSelection,
    withoutSelection:
      withoutSelection === 'replaceSelection' ? 'showMenu' : withoutSelection,
  }
}

/** Output handling belongs to the invocation context, not the tool. */
export function commandAfterRun(
  command: CommandConfig,
  source: CommandRunSource = 'menu',
  hasSelection = false
): ResultSink {
  return resolveSink(commandInvocation(command), { source, hasSelection })
}

function headersOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

/** A whole number of seconds the script may run, or `undefined` for none */
function timeoutOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const seconds = Math.round(value)
  return seconds >= 1 ? Math.min(seconds, SCRIPT_MAX_TIMEOUT_SEC) : undefined
}

export function scriptToolConfigOf(
  config: Record<string, unknown>
): ScriptToolConfig {
  const timeoutSec = timeoutOf(config.timeoutSec)
  return {
    command: stringOr(config.command),
    workingDir: stringOr(config.workingDir),
    ...(timeoutSec ? { timeoutSec } : {}),
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
    launcherAfterRun: normalizeLauncherAfterRun(
      value.launcherAfterRun,
      value.afterRun
    ),
    logOutput: value.logOutput === true,
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
      return { command: '', workingDir: '' }
    case 'webhook':
      return {
        url: '',
        method: 'POST',
        headers: {},
        payloadTemplate: '',
        authSecret: false,
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
    launcherAfterRun: launcherAfterRunFromLegacy(tool?.defaultAfterRun),
    logOutput: false,
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
  return command.enabled && isCommandAvailable(command, tools)
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
    llmArgumentParsing: command.llmArgumentParsing,
    logOutput: command.logOutput,
    launcherSink: command.launcherAfterRun,
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

/** What keeps the command from running as the user expects */
export function validateCommand(
  command: CommandConfig,
  tools: ToolLookup
): CommandIssue[] {
  const issues: CommandIssue[] = []
  if (!command.name.trim()) {
    issues.push({ field: 'name', messageKey: 'commands.errorNoName' })
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
  } else if (command.toolId === 'core.aiTask') {
    if (!stringOr(command.toolConfig.prompt).trim()) {
      issues.push({ field: 'prompt', messageKey: 'commands.errorNoPrompt' })
    }
  } else if (!commandTool(command, tools)) {
    issues.push({ field: 'toolId', messageKey: 'commands.errorUnknownTool' })
  }
  return issues
}

/** Who added a default command, or `undefined` for one the user made */
export function commandAddedBy(
  command: CommandConfig,
  tools: ToolLookup
): ToolOwner | undefined {
  if (!command.id.startsWith('default:')) return undefined
  return tools.get(command.toolId)?.owner ?? { kind: 'core' }
}

const shellQuote = (value: string): string =>
  /^[\w:.@-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`

/**
 * The shell line that runs the command from another application: by its name
 * when `byName`, otherwise by its id
 */
export function commandCliCall(target: string, byName = false): string {
  return `tyco-ctl run ${shellQuote(target)}${byName ? ' --name' : ''}`
}

/** The library with a removed command put back where it was */
export function restoreCommand(
  commands: readonly CommandConfig[],
  command: CommandConfig,
  index: number
): CommandConfig[] {
  if (commands.some((item) => item.id === command.id)) return [...commands]
  const next = [...commands]
  next.splice(Math.min(Math.max(index, 0), next.length), 0, command)
  return next
}

/**
 * The menu with the items of a removed command put back: the slots that held it
 * before and are still empty
 */
export function restoreCommandReferences(
  slots: readonly (MainActionConfig | null)[],
  previous: readonly (MainActionConfig | null)[],
  commandId: string
): (MainActionConfig | null)[] {
  return slots.map((slot, index) => {
    const before = previous[index]
    return slot === null &&
      before?.type === 'command' &&
      before.commandId === commandId
      ? before
      : slot
  })
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
