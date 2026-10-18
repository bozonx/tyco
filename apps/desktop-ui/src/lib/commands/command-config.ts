import {
  CUSTOM_ACTION_AFTER_RUN,
  type CommandConfig,
  type CommandLauncherAfterRun,
  type CustomActionAfterRun,
  SCRIPT_MAX_TIMEOUT_SEC,
  SHORTCUT_SLOT_KEYS,
  type ScriptToolConfig,
  type WebhookToolConfig,
} from '@tyco/shared'
import type { RegisteredTool } from '../tools/tool-types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const afterRunOf = (value: unknown): CustomActionAfterRun =>
  CUSTOM_ACTION_AFTER_RUN.includes(value as CustomActionAfterRun)
    ? (value as CustomActionAfterRun)
    : 'none'

/** Maps a tool output default to the quick-command output settings */
export function launcherAfterRunFromOutput(
  value: unknown
): CommandLauncherAfterRun {
  return { action: afterRunOf(value) }
}

function normalizeLauncherAfterRun(value: unknown): CommandLauncherAfterRun {
  return { action: afterRunOf(isRecord(value) ? value.action : undefined) }
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
    workingDirectory: stringOr(config.workingDirectory),
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
    isAuthEnabled: config.isAuthEnabled === true,
    ...(typeof config.authSecretId === 'string'
      ? { authSecretId: config.authSecretId }
      : {}),
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
    isVoiceEnabled: value.isVoiceEnabled === true,
    voiceConfirmation: value.voiceConfirmation === 'auto' ? 'auto' : 'always',
    phrases: Array.isArray(value.phrases)
      ? value.phrases.filter((item): item is string => typeof item === 'string')
      : [],
    toolId,
    toolConfig: isRecord(value.toolConfig) ? value.toolConfig : {},
    isLlmArgumentParsingEnabled: value.isLlmArgumentParsingEnabled === true,
    launcherAfterRun: normalizeLauncherAfterRun(value.launcherAfterRun),
    isOutputLogged: value.isOutputLogged === true,
    availableIn: {
      external: availableIn.external === true,
      chat: availableIn.chat === true,
    },
    isEnabled: value.isEnabled !== false,
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

/** The command ids of a launcher page in key order; a missing command leaves its slot empty */
export function normalizeLauncherCommands(
  value: unknown,
  commands: readonly CommandConfig[] = []
): (string | null)[] {
  const source: Record<string, unknown> =
    isRecord(value) ? value : {}
  const existingIds = new Set(commands.map((c) => c.id))
  return SHORTCUT_SLOT_KEYS.map((key) => {
    const id = source[key]
    return typeof id === 'string' && existingIds.has(id) ? id : null
  })
}

function newCommandId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `command-${Date.now()}`
}

/** The settings a new command of the tool starts with */
function defaultToolConfig(toolId: string): Record<string, unknown> {
  switch (toolId) {
    case 'script':
      return { command: '', workingDirectory: '' }
    case 'webhook':
      return {
        url: '',
        method: 'POST',
        headers: {},
        payloadTemplate: '',
        isAuthEnabled: false,
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
    isVoiceEnabled: false,
    voiceConfirmation: 'always',
    toolId,
    toolConfig: defaultToolConfig(toolId),
    isLlmArgumentParsingEnabled: false,
    launcherAfterRun: launcherAfterRunFromOutput(tool?.defaultAfterRun),
    isOutputLogged: false,
    availableIn: { external: false, chat: false },
    isEnabled: true,
  }
}
