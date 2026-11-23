import type { ToolRef } from './tools-config'
import configDefaults from '../user-config-defaults.json' with { type: 'json' }
import { type LlmConfig, MAX_TOOL_STEPS, maxToolStepsOf } from './llm-config'
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
  'openHistory',
  'openEditor',
  'openDialog',
  'voiceInput',
  'listen',
  'voiceCommands',
  'translationMenu',
  'transformationMenu',
  'stylingMenu',
  'chatPromptsMenu',
  'favoritesMenu',
  'quickAiRequest',
  'voiceQuickAiRequest',
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
  'askInCurrentChat',
  'askInNewChat',
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

/**
 * Operations over what the app already does, see
 * `lib/operations/core-operations.ts`
 */
export const CORE_TOOL_IDS = [
  'core.insert',
  'core.copy',
  'core.correct',
  'core.translate',
  'core.aiTask',
  'core.transformation',
  'core.styling',
  'core.askInChat',
  'core.askInCurrentChat',
  'core.askInNewChat',
] as const
export type CoreOperationId = (typeof CORE_TOOL_IDS)[number]

/** `operationConfig` of a `script` command */
export interface ScriptOperationConfig {
  /**
   * A shell command; `{{TEXT}}` is replaced with the text, quoted. The command
   * takes the text only when it mentions `{{TEXT}}`, see `scriptTakesText`
   */
  command: string
  /** Empty for the home directory */
  workingDirectory?: string
  /**
   * Started on its own and not waited for, e.g. a launcher of a GUI app: Tyco
   * neither cancels nor stops it, nor reads its output or exit code
   */
  isDetached?: boolean
}

/**
 * How long a run of a command may take by default, in seconds (5 minutes); 0
 * disables the limit (unbounded).
 */
export const COMMAND_RUN_TIMEOUT_DEFAULT_SEC = 300
/** The longest finite run limit of a command, in seconds */
export const COMMAND_RUN_TIMEOUT_MAX_SEC = 3600

/**
 * The step limit for AI commands from `commandAiMaxSteps`, or
 * `llm.maxToolSteps` (or `DEFAULT_MAX_TOOL_STEPS`) when unset or out of range.
 */
export function commandAiMaxStepsOf(
  config:
    | { commandAiMaxSteps?: number; llm?: Pick<LlmConfig, 'maxToolSteps'> }
    | undefined
): number {
  const steps = config?.commandAiMaxSteps
  return typeof steps === 'number' &&
    Number.isInteger(steps) &&
    steps >= 1 &&
    steps <= MAX_TOOL_STEPS
    ? steps
    : maxToolStepsOf(config?.llm)
}

/**
 * `operationConfig` of an AI command, a command of the `core.aiTask` tool: an
 * LLM agent that follows `prompt` and may call the tools of `tools`
 */
export interface AiCommandOperationConfig {
  prompt: string
  /**
   * The whitelist of the agent: commands (never the command itself), the web,
   * plugin tools, MCP tools. All of them run without asking; empty for an agent
   * without tools
   */
  tools: ToolRef[]
}

/** `operationConfig` of a `webhook` command */
export interface WebhookOperationConfig {
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
export const scriptTakesText = (
  config: Pick<ScriptOperationConfig, 'command'>
) => config.command.includes(ACTION_TEXT_PLACEHOLDER)

/**
 * Whether a webhook takes the text: `{{TEXT}}` is in its URL or in the body of
 * a POST request. Keep in sync with `webhook_takes_text` in
 * `src-tauri/src/services/external/command_library.rs`
 */
export const webhookTakesText = (
  config: Pick<WebhookOperationConfig, 'url' | 'method' | 'payloadTemplate'>
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
  config: Pick<ScriptOperationConfig, 'command'>
) => config.command.includes(ACTION_SELECTION_PLACEHOLDER)

/**
 * Whether a webhook mentions `{{SELECTION}}`. Keep in sync with
 * `webhook_mentions_selection` in
 * `src-tauri/src/services/external/command_library.rs`
 */
export const webhookTakesSelection = (
  config: Pick<WebhookOperationConfig, 'url' | 'method' | 'payloadTemplate'>
) =>
  config.url.includes(ACTION_SELECTION_PLACEHOLDER) ||
  (config.method !== 'GET' &&
    Boolean(config.payloadTemplate?.includes(ACTION_SELECTION_PLACEHOLDER)))

/** Whether a command uses `{{SELECTION}}` in its script or webhook settings */
export const commandTakesSelection = (
  command: Pick<CommandConfig, 'operationId' | 'operationConfig'>
): boolean => {
  if (command.operationId === 'script') {
    return (
      typeof command.operationConfig.command === 'string' &&
      scriptTakesSelection(
        command.operationConfig as unknown as Pick<
          ScriptOperationConfig,
          'command'
        >
      )
    )
  }
  if (command.operationId === 'webhook') {
    return (
      typeof command.operationConfig.url === 'string' &&
      webhookTakesSelection(
        command.operationConfig as unknown as Pick<
          WebhookOperationConfig,
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
  /** `script`, `webhook`, `core.<tool>` or `<pluginId>.<operationId>` */
  operationId: string
  /** Values for the tool's config fields */
  operationConfig: Record<string, unknown>
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

/** A prompt of `chatPrompts`, by its `id` */
export interface ChatPromptMainAction {
  type: 'chatPrompt'
  promptId: string
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
  /** The vault of an attached one; absent for the main vault */
  vaultId?: string
}

export const PROFILE_ACTION_KINDS = [
  'quickAiRequest',
  'voiceQuickAiRequest',
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
  'chat',
] as const
export type ProfileActionKind = (typeof PROFILE_ACTION_KINDS)[number]

/** An AI profile action in the action menu */
export interface ProfileMainAction {
  type: 'profile'
  profileId: string
  /** The vault of an attached one; absent for the main vault */
  vaultId?: string
  action: ProfileActionKind
}

/** Opens an action page by its index */
export interface ActionPageMainAction {
  type: 'actionPage'
  pageIndex: number
}

export type MainActionConfig =
  | StandardMainAction
  | PluginMainAction
  | CommandMainAction
  | TransformationMainAction
  | StylingMainAction
  | ChatPromptMainAction
  | TranslationMainAction
  | ProfileChatMainAction
  | ProfileMainAction
  | ActionPageMainAction

/** A configured action page; pages are addressed by index. */
export interface ActionPageConfig {
  inputMode: 'selection' | 'none'
  slots: ShortcutSlots<MainActionConfig>
}

export const DEFAULT_ACTION_PAGES =
  configDefaults.actionPages as ActionPageConfig[]

export const DEFAULT_MAIN_ACTIONS = DEFAULT_ACTION_PAGES[0].slots

/** A configured custom hotkey slot */
export interface CustomActionSlotConfig {
  action: MainActionConfig | null
  takesSelection: boolean
}

export const DEFAULT_CUSTOM_ACTION_SLOTS =
  configDefaults.customActionSlots as CustomActionSlotConfig[]

export const BUILTIN_TRANSLATE_COMMAND_ID = 'translate'

/**
 * The synthetic command representing the built-in translation tool in voice
 * commands
 */
export function builtinTranslateCommand(): CommandConfig {
  return {
    id: BUILTIN_TRANSLATE_COMMAND_ID,
    name: '',
    description: '',
    phrases: [],
    isVoiceEnabled: true,
    operationId: 'core.translate',
    operationConfig: {},
    isLlmArgumentParsingEnabled: false,
    isLlmPreTransformEnabled: false,
    llmPreTransformPrompt: '',
    outputAction: 'insertIntoWindow',
    isOutputLogged: false,
    isAvailableExternally: false,
    isEnabled: true,
  }
}
