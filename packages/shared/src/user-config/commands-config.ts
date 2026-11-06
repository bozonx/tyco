import configDefaults from '../user-config-defaults.json' with { type: 'json' }
import type { ShortcutSlots } from './translation-config'

/**
 * The built-in items of the action menu. `translationMenu` opens a menu to pick
 * from; a single language is an item of the `translation` type
 */
export const STANDARD_ACTION_IDS = [
  'insertIntoWindow',
  'copyToClipboard',
  'correction',
  'directCorrection',
  'askInChat',
  'translationMenu',
  'transformationMenu',
  'stylingMenu',
  'chatPromptsMenu',
  'quickAiRequest',
  'voiceQuickAiRequest',
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
  'voiceCommands',
  'voiceCommandsWithoutContext',
  'favoritesMenu',
  'openHistory',
  'voiceInput',
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

/** Stands in for the selection in a command, a webhook URL or its payload */
export const ACTION_SELECTION_PLACEHOLDER = '{{SELECTION}}'

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

/**
 * The platforms a command may be limited to; a command of another one stays in
 * the config and the grids but does not run there
 */
export const COMMAND_PLATFORMS = ['linux', 'windows'] as const
export type CommandPlatform = (typeof COMMAND_PLATFORMS)[number]

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
}

/**
 * How long a background external run of a command may take by default, in
 * seconds. Runs in a window have no limit: the user sees them and can cancel
 */
export const EXTERNAL_TIMEOUT_DEFAULT_SEC = 120
/** The longest limit of a background external run, in seconds */
export const EXTERNAL_TIMEOUT_MAX_SEC = 3600

/** How many model steps an AI command takes by default; each tool call is one */
export const AI_COMMAND_MAX_STEPS_DEFAULT = 5
/** The most model steps an AI command may take */
export const AI_COMMAND_MAX_STEPS_MAX = 50

/**
 * `toolConfig` of an AI command, a command of the `core.aiTask` tool: an LLM
 * agent that follows `prompt` and may call the commands of `allowedCommandIds`
 */
export interface AiCommandToolConfig {
  prompt: string
  /** The commands the agent may run; never the command itself */
  allowedCommandIds: string[]
  /** Maximum command calls per run; the final answer does not consume a call. */
  maxSteps: number
}

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
 * Whether a script mentions `{{SELECTION}}`. Keep in sync with
 * `script_mentions_selection` in
 * `src-tauri/src/services/external/command_library.rs`
 */
export const scriptTakesSelection = (
  config: Pick<ScriptToolConfig, 'command'>
) => config.command.includes(ACTION_SELECTION_PLACEHOLDER)

/**
 * Whether a webhook mentions `{{SELECTION}}`. Keep in sync with
 * `webhook_mentions_selection` in
 * `src-tauri/src/services/external/command_library.rs`
 */
export const webhookTakesSelection = (
  config: Pick<WebhookToolConfig, 'url' | 'method' | 'payloadTemplate'>
) =>
  config.url.includes(ACTION_SELECTION_PLACEHOLDER) ||
  (config.method !== 'GET' &&
    Boolean(config.payloadTemplate?.includes(ACTION_SELECTION_PLACEHOLDER)))

/** Whether a command uses `{{SELECTION}}` in its script or webhook settings */
export const commandTakesSelection = (
  command: Pick<CommandConfig, 'toolId' | 'toolConfig'>
): boolean => {
  if (command.toolId === 'script') {
    return (
      typeof command.toolConfig.command === 'string' &&
      scriptTakesSelection(
        command.toolConfig as unknown as Pick<ScriptToolConfig, 'command'>
      )
    )
  }
  if (command.toolId === 'webhook') {
    return (
      typeof command.toolConfig.url === 'string' &&
      webhookTakesSelection(
        command.toolConfig as unknown as Pick<
          WebhookToolConfig,
          'url' | 'method' | 'payloadTemplate'
        >
      )
    )
  }
  return false
}

/**
 * A user command of the command library: a tool with its settings, invoked from
 * the action menu, voice, external calls and the chat. See
 * `dev_docs/design-voice-commands.md`
 */
export interface CommandConfig {
  /** Stable */
  id: string
  name: string
  /**
   * Tells the LLM what the command does; the agent and LLM parsing use it.
   * Empty when there is none: the schema requires the field
   */
  description: string
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
  /** Pre-transform the text with LLM before it is passed to the command */
  isLlmPreTransformEnabled?: boolean
  /** Prompt for the LLM pre-transformation */
  llmPreTransformPrompt?: string
  /**
   * What the action menu or external invocation does with the returned text;
   * the other places a command runs from handle it their own way
   */
  outputAction: CommandOutputAction
  isOutputLogged: boolean
  /** Local applications may run it through tyco-ctl and D-Bus */
  isAvailableExternally: boolean
  /**
   * How long a background external run may take, in seconds, counted from its
   * start; a run in a window has no limit
   */
  externalTimeoutSec: number
  isEnabled: boolean
  /** The platforms it runs on; absent or empty for every one */
  platforms?: CommandPlatform[]
}

/** A command of the library placed in the action menu */
export interface CommandMainAction {
  type: 'command'
  commandId: string
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

/** Ask in the chat of an AI profile */
export interface ProfileChatMainAction {
  type: 'profileChat'
  profileId: string
}

export type MainActionConfig =
  | StandardMainAction
  | PluginMainAction
  | CommandMainAction
  | TransformationMainAction
  | StylingMainAction
  | TranslationMainAction
  | ProfileChatMainAction

/** A configured action page; pages are addressed by index. */
export interface ActionPageConfig {
  inputMode: 'selection' | 'none'
  slots: ShortcutSlots<MainActionConfig>
}

export const DEFAULT_ACTION_PAGES =
  configDefaults.actionPages as ActionPageConfig[]

export const DEFAULT_MAIN_ACTIONS = DEFAULT_ACTION_PAGES[0].slots
