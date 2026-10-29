import configDefaults from '../user-config-defaults.json' with { type: 'json' }
import type { ShortcutSlots } from './translation-config'

/**
 * The built-in items of the action menu. `aiTaskMenu` and `translationMenu`
 * open a menu to pick from; a single task or language is an item of the
 * `aiTask` or `translation` type
 */
export const STANDARD_ACTION_IDS = [
  'insertIntoWindow',
  'copyToClipboard',
  'aiTaskMenu',
  'transformationMenu',
  'stylingMenu',
  'correction',
  'translationMenu',
  'askInChat',
] as const

export type StandardActionId = (typeof STANDARD_ACTION_IDS)[number]

export interface StandardMainAction {
  type: 'standard'
  actionId: StandardActionId
}

export interface PluginMainAction {
  type: 'plugin'
  actionId: string
}

/** Stands in for the text in a command, a webhook URL or its payload */
export const ACTION_TEXT_PLACEHOLDER = '{{TEXT}}'

/**
 * What a command does with the text its tool returns: nothing, the result menu,
 * pasting it into the window the user works in (over the selection, if there is
 * one), or the clipboard
 */
export const COMMAND_OUTPUT_ACTIONS = [
  'none',
  'showMenu',
  'insertIntoWindow',
  'copyToClipboard',
] as const
export type CommandOutputAction = (typeof COMMAND_OUTPUT_ACTIONS)[number]

/** Tools that run what the user configured; the way out for anything else */
export const BUILTIN_TOOL_IDS = ['script', 'webhook'] as const
export type BuiltinToolId = (typeof BUILTIN_TOOL_IDS)[number]

/** Tools over what the app already does, see `lib/tools/core-tools.ts` */
export const CORE_TOOL_IDS = [
  'core.insert',
  'core.copy',
  'core.correct',
  'core.translate',
  'core.aiTask',
  'core.transformation',
  'core.styling',
  'core.askInChat',
] as const
export type CoreToolId = (typeof CORE_TOOL_IDS)[number]

/** `toolConfig` of a `script` command */
export interface ScriptToolConfig {
  /**
   * A shell command; `{{TEXT}}` is replaced with the text, quoted. The command
   * takes the text only when it mentions `{{TEXT}}`, see `scriptTakesText`
   */
  command: string
  /** Empty for the home directory */
  workingDirectory?: string
  /**
   * How long the output is waited for, in seconds; absent for
   * `SCRIPT_OUTPUT_TIMEOUT_SEC`
   */
  timeoutSec?: number
}

/** How long a script whose output is used runs by default, in seconds */
export const SCRIPT_OUTPUT_TIMEOUT_SEC = 60
/** The longest a script whose output is used may run, in seconds */
export const SCRIPT_MAX_TIMEOUT_SEC = 3600

/** `toolConfig` of a `webhook` command */
export interface WebhookToolConfig {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  payloadTemplate?: string
  /**
   * The Authorization header is kept in the secret store under `authSecretId`,
   * bound to the origin of the URL
   */
  isAuthEnabled?: boolean
  /** Opaque secret identity, independent of the command display name and id. */
  authSecretId?: string
}

/**
 * Whether a script takes the text: its command mentions `{{TEXT}}`. Keep in
 * sync with `script_takes_text` in
 * `src-tauri/src/services/external/command_library.rs`
 */
export const scriptTakesText = (config: Pick<ScriptToolConfig, 'command'>) =>
  config.command.includes(ACTION_TEXT_PLACEHOLDER)

/**
 * Whether a webhook takes the text: `{{TEXT}}` is in its URL or in the body of
 * a POST request. Keep in sync with `webhook_takes_text` in
 * `src-tauri/src/services/external/command_library.rs`
 */
export const webhookTakesText = (
  config: Pick<WebhookToolConfig, 'url' | 'method' | 'payloadTemplate'>
) =>
  config.url.includes(ACTION_TEXT_PLACEHOLDER) ||
  (config.method !== 'GET' &&
    Boolean(config.payloadTemplate?.includes(ACTION_TEXT_PLACEHOLDER)))

/**
 * A user command of the command library: a tool with its settings, invoked from
 * the action menu, the command launcher, voice, external calls and the chat.
 * See `dev_docs/design-voice-commands.md`
 */
export interface CommandConfig {
  /** Stable */
  id: string
  name: string
  /** Tells the LLM what the command does; the agent and LLM parsing use it */
  description?: string
  /** Explicit literal voice phrases; the display name is never matched. */
  phrases: string[]
  isVoiceEnabled: boolean
  /** `script`, `webhook`, `core.<tool>` or `<pluginId>.<toolId>` */
  toolId: string
  /** Values for the tool's config fields */
  toolConfig: Record<string, unknown>
  /**
   * Fill a structured input from text with the LLM; only for tools that take a
   * structured input and do not parse text themselves
   */
  isLlmArgumentParsingEnabled: boolean
  /**
   * What the command launcher does with the returned text; the other places a
   * command runs from handle it their own way
   */
  outputAction: CommandOutputAction
  isOutputLogged: boolean
  /** Local applications may run it through tyco-ctl and D-Bus */
  isAvailableExternally: boolean
  isEnabled: boolean
}

/** A command of the library placed in the action menu */
export interface CommandMainAction {
  type: 'command'
  commandId: string
}

/** A task of `aiTasks`, by its `id` */
export interface AiTaskMainAction {
  type: 'aiTask'
  taskId: string
}

/** A transformation of `transformations`, by its `id` */
export interface TransformationMainAction {
  type: 'transformation'
  transformationId: string
}

/** A style of `styling`, by its `id` */
export interface StylingMainAction {
  type: 'styling'
  stylingId: string
}

/** A translation into one of `translation.targetLanguages` */
export interface TranslationMainAction {
  type: 'translation'
  language: string
}

export type MainActionConfig =
  | { type: 'launcherPage'; pageId: string }
  | StandardMainAction
  | PluginMainAction
  | CommandMainAction
  | AiTaskMainAction
  | TransformationMainAction
  | StylingMainAction
  | TranslationMainAction

export const DEFAULT_MAIN_ACTIONS =
  configDefaults.mainActions as ShortcutSlots<MainActionConfig>

/** A configured launcher page; references stay stable when pages move. */
export interface LauncherPageConfig {
  id: string
  inputMode: 'selection' | 'none'
  /** Opens the page; empty for none */
  hotkey: string
  /** Command ids */
  slots: ShortcutSlots<string>
}
