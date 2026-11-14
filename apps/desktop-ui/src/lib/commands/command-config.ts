import { isRecord } from '@tyco/shared/value-guards'
import {
  COMMAND_OUTPUT_ACTIONS,
  COMMAND_PLATFORMS,
  type CommandConfig,
  type CommandOutputAction,
  type CommandPlatform,
  AI_COMMAND_MAX_STEPS_DEFAULT,
  EXTERNAL_TIMEOUT_DEFAULT_SEC,
  EXTERNAL_TIMEOUT_MAX_SEC,
  normalizeCommands,
  type ScriptOperationConfig,
  type WebhookOperationConfig,
} from '@tyco/shared'
import type { RegisteredOperation } from '../operations/operation-types'

/** Whether a tool can be chosen to create a command from in the commands library */
export function isCommandOperation(
  tool: Pick<RegisteredOperation, 'id' | 'owner' | 'configFields'>
): boolean {
  if (
    tool.id === 'script' ||
    tool.id === 'webhook' ||
    tool.id === 'core.aiTask' ||
    tool.id === 'core.translate'
  ) {
    return true
  }
  if (tool.owner.kind === 'plugin' && (tool.configFields?.length ?? 0) > 0) {
    return true
  }
  return false
}

/** The value if it is a string, otherwise an empty string */
export const stringOr = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** The output action of a tool, or `none` */
const outputActionOf = (value: unknown): CommandOutputAction =>
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

/**
 * The limit of a background external run as a whole number of seconds within
 * range, or the default for anything else
 */
export function externalTimeoutOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return EXTERNAL_TIMEOUT_DEFAULT_SEC
  const seconds = Math.round(value)
  return seconds >= 1
    ? Math.min(seconds, EXTERNAL_TIMEOUT_MAX_SEC)
    : EXTERNAL_TIMEOUT_DEFAULT_SEC
}

export function scriptOperationConfigOf(
  config: Record<string, unknown>
): ScriptOperationConfig {
  return {
    command: stringOr(config.command),
    workingDirectory: stringOr(config.workingDirectory),
  }
}

/** A webhook config as read from a command: its method and headers are set */
export type ResolvedWebhookOperationConfig = WebhookOperationConfig &
  Required<Pick<WebhookOperationConfig, 'method' | 'headers'>>

export function webhookOperationConfigOf(
  config: Record<string, unknown>
): ResolvedWebhookOperationConfig {
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
export const operationConfigText = (
  command: CommandConfig,
  key: string
): string => stringOr(command.operationConfig[key])

export const scriptOperationConfig = (
  command: CommandConfig
): ScriptOperationConfig => scriptOperationConfigOf(command.operationConfig)

export const webhookOperationConfig = (
  command: CommandConfig
): ResolvedWebhookOperationConfig =>
  webhookOperationConfigOf(command.operationConfig)

export { normalizeCommands }

function newCommandId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID()
  // without crypto, the time alone repeats for commands made at once
  return `command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The settings a new command of the tool starts with */
function defaultOperationConfig(operationId: string): Record<string, unknown> {
  switch (operationId) {
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
    case 'core.aiTask':
      return {
        prompt: '',
        allowedCommandIds: [],
        maxSteps: AI_COMMAND_MAX_STEPS_DEFAULT,
        isToolsEnabled: true,
      }
    default:
      // a plugin tool falls back to the plugin settings for empty fields
      return {}
  }
}

/**
 * A new command of the library with the defaults for its tool; `tool` gives
 * what to do with the output of a tool that returns a text, and
 * `currentPlatform` initializes the platform filter when the tool uses one
 */
export function createCommand(
  operationId: string,
  id: string = newCommandId(),
  tool?: Pick<
    RegisteredOperation,
    'defaultOutputAction' | 'canSelectPlatforms'
  >,
  currentPlatform?: string
): CommandConfig {
  const defaultPlatforms =
    tool?.canSelectPlatforms &&
    COMMAND_PLATFORMS.includes(currentPlatform as CommandPlatform)
      ? [currentPlatform as CommandPlatform]
      : undefined
  return {
    id,
    name: '',
    description: '',
    phrases: [],
    isVoiceEnabled: false,
    operationId,
    operationConfig: defaultOperationConfig(operationId),
    isLlmArgumentParsingEnabled: false,
    isLlmPreTransformEnabled: false,
    llmPreTransformPrompt: '',
    outputAction: outputActionOf(tool?.defaultOutputAction),
    isOutputLogged: false,
    isAvailableExternally: false,
    externalTimeoutSec: EXTERNAL_TIMEOUT_DEFAULT_SEC,
    isEnabled: true,
    ...(defaultPlatforms ? { platforms: defaultPlatforms } : {}),
  }
}
