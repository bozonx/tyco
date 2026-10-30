import { isRecord } from '@tyco/shared/value-guards'
import {
  COMMAND_OUTPUT_ACTIONS,
  type CommandConfig,
  type CommandOutputAction,
  normalizeCommands,
  SCRIPT_MAX_TIMEOUT_SEC,
  SHORTCUT_SLOT_KEYS,
  type ScriptToolConfig,
  type WebhookToolConfig,
} from '@tyco/shared'
import type { RegisteredTool } from '../tools/tool-types'

const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** The output action of a tool, or `none` */
export const outputActionOf = (value: unknown): CommandOutputAction =>
  COMMAND_OUTPUT_ACTIONS.includes(value as CommandOutputAction)
    ? (value as CommandOutputAction)
    : 'none'

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

/** A text setting of the command's tool, or an empty string */
export const toolConfigText = (command: CommandConfig, key: string): string =>
  stringOr(command.toolConfig[key])

export const scriptToolConfig = (command: CommandConfig): ScriptToolConfig =>
  scriptToolConfigOf(command.toolConfig)

export const webhookToolConfig = (command: CommandConfig): WebhookToolConfig =>
  webhookToolConfigOf(command.toolConfig)

export { normalizeCommands }

/**
 * The command ids of a launcher page in key order; a missing command leaves its
 * slot empty
 */
export function normalizeLauncherCommands(
  value: unknown,
  commands: readonly CommandConfig[] = []
): (string | null)[] {
  const source: Record<string, unknown> = isRecord(value) ? value : {}
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
    case 'core.transformation':
    case 'core.styling':
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
  tool?: Pick<RegisteredTool, 'defaultOutputAction'>
): CommandConfig {
  return {
    id,
    name: '',
    phrases: [],
    isVoiceEnabled: false,
    toolId,
    toolConfig: defaultToolConfig(toolId),
    isLlmArgumentParsingEnabled: false,
    isLlmPreTransformEnabled: false,
    llmPreTransformPrompt: '',
    outputAction: outputActionOf(tool?.defaultOutputAction),
    isOutputLogged: false,
    isAvailableExternally: false,
    isEnabled: true,
  }
}
