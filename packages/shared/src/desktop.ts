import type { SelectionRunEvent } from './selection'
import { APP_CONFIG, type AppConfig } from './app-config'
import { DEFAULT_USER_CONFIG, type UserConfig } from './user-config'

export type DesktopErrorCode =
  | 'operationFailed'
  | 'configConflict'
  | 'serviceUnavailable'
  | 'resourceLimit'
  | 'invalidInput'
  | 'unsupportedConfig'
  | 'runtimeError'
  | 'ioError'
  | 'invalidData'

export interface DesktopErrorPayload {
  code: DesktopErrorCode
  message: string
}

export interface IpcResult<T = unknown> {
  success: boolean
  error?: string
  errorCode?: DesktopErrorCode
  result?: T
}

/**
 * Where an attached text came from: `selection` was selected in another
 * application, the others come from the editor of the app
 */
export type ChatAttachmentSource =
  'selection' | 'editor-selection' | 'editor-text'

export interface ChatAttachment {
  text: string
  /** Unknown for attachments stored before the source was kept */
  source?: ChatAttachmentSource
  name?: string
  mediaType?: string
}

/**
 * A normalized image owned by the Rust chat image store; PNG only in chats
 * saved before WebP.
 */
export interface ChatImage {
  id: string
  mediaType: 'image/webp' | 'image/png'
  width: number
  height: number
  size: number
  name?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'developer'
  content: string
  images?: ChatImage[]
  attachments?: ChatAttachment[]
  status?: 'complete' | 'stopped'
}

export enum START_MODES {
  SELECT = 'select',
  VOICE = 'voice',
  AI_TASKS = 'aiTasks',
  COMMAND_LAUNCHER = 'commandLauncher',
  CORRECTION = 'correction',
  TRANSLATE = 'translate',
  EDITOR = 'editor',
  WRITE = 'write',
  CHAT = 'chat',
  VOICE_CHAT = 'voiceChat',
  HISTORY = 'history',
  CONFIG = 'config',
  /** Asks whether an external call may use the selection; Tyco opens it itself */
  EXTERNAL_ACCESS = 'externalAccess',
}

export interface ChatParams {
  id?: string
  /** The title the chat has in the history */
  title?: string
  images?: ChatImage[]
  attachments?: ChatAttachment[]
  /**
   * The chat takes nothing from the editor: it was started for a question about
   * a text selected in another application
   */
  withoutEditorContext?: boolean
}

export interface ChatHistoryItem {
  id: string
  description: string
  lastMsgDate: string
  messages: ChatMessage[]
}

/**
 * Why a text got into the editor history:
 *
 * - `output` — inserted into a window or copied to the clipboard;
 * - `draft` — unsent text: discarded from the editor or kept there while the
 *   window was hidden;
 * - `source` — snapshot taken right before an AI transformation.
 */
export type EditorHistoryKind = 'output' | 'draft' | 'source'

/** The AI transformation a `source` entry was taken before. */
export type EditorHistoryOperation =
  'ai-task' | 'translate' | 'correction' | 'voice-correction'

export interface EditorHistoryEntry {
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation
  /** A draft this entry supersedes: the same editing session saved again. */
  replaceId?: string
}

export interface EditorHistoryItem {
  id: string
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation
  /** Unix time in milliseconds, 0 when unknown. */
  createdAt: number
  /** What the AI turned a `source` entry into. */
  result?: string
  /** The `result` of a `source` entry was inserted into a window or copied. */
  sent?: boolean
}

/** What a storage location holds; history and chats are data. */
export type StorageKind = 'config' | 'data' | 'cache' | 'logs'

/**
 * A root directory of the app's files. The platform may put several kinds into
 * one directory, e.g. the config and the data into `%APPDATA%` on Windows.
 */
export interface StorageLocation {
  kinds: StorageKind[]
  path: string
}

export interface StorageInfo {
  locations: StorageLocation[]
}

export interface LocalState {
  lastChatId?: string | null
  lastMode?: START_MODES | null
  /** The model the chat was last used with */
  lastChatModelId?: string | null
  /** Own AI requests typed in the AI task menu, the newest first */
  recentAiPrompts?: string[]
  /** Languages picked from the full list in the translate menu, newest first */
  recentTranslateLanguages?: string[]
  /** Preferred diff view mode: unified | split | result */
  diffMode?: 'unified' | 'split' | 'result' | null
  /** Preferred translation view mode in preview menu: split | result */
  translationViewMode?: 'split' | 'result' | null
}

export const DEFAULT_LOCAL_STATE: LocalState = { lastChatId: null }

export interface InitParams {
  activationId: number
  windowId: string | null
  selectedText: string | null
  mode: START_MODES | null
  userConfig: UserConfig
  localState: LocalState
  appConfig: AppConfig
  isWindowShown: boolean
  windowProfile: 'panel' | 'sheet'
  /** The command the command overlay opens with, for an external call */
  launcherPage?: number
  launcherRequest?: LauncherRequest | null
  /** What the access prompt asks about, see `START_MODES.EXTERNAL_ACCESS` */
  accessRequest?: AccessRequest | null
}

/** An external call that wants the selection while access to it is off */
export interface AccessRequest {
  jobId: string
  commandName: string
  /** The output is to replace the selection, not only to be returned */
  replace: boolean
}

export type AccessDecision = 'once' | 'always' | 'deny'

export type CapturedContext = Pick<InitParams, 'selectedText'>

export interface EditorTransfer {
  text?: string
  sourceText?: string
}

export const DEFAULT_INIT_PARAMS: InitParams = {
  activationId: 0,
  windowId: null,
  selectedText: null,
  mode: START_MODES.EDITOR,
  userConfig: DEFAULT_USER_CONFIG,
  localState: DEFAULT_LOCAL_STATE,
  appConfig: APP_CONFIG,
  isWindowShown: false,
  windowProfile: 'sheet',
}

export const DESKTOP_EVENTS = {
  PLUGINS_CHANGED: 'plugins-changed',
  PARAMS_CHANGED: 'app://params-changed',
  CONTEXT_CAPTURED: 'app://context-captured',
  HOTKEYS_CHANGED: 'app://hotkeys-changed',
  OPEN_MAIN_CHAT: 'app://open-main-chat',
  OPEN_MAIN_EDITOR: 'app://open-main-editor',
  /** The user closed the main window rather than hid it */
  MAIN_WINDOW_CLOSED: 'app://main-window-closed',
  ACTIVATION_METRICS_START: 'app://activation-metrics-start',
  ACTIVATION_METRICS_COLLECT: 'app://activation-metrics-collect',
  VOICE_AUDIO_LEVEL: 'app://voice-audio-level',
  SELECTION_RUN: 'app://selection-run',
  SELECTION_CANCEL: 'app://selection-cancel',
  /** An external call runs a command in the background */
  COMMAND_RUN: 'app://command-run',
  EXTERNAL_JOB_CANCEL: 'app://external-job-cancel',
} as const

/** Serialized payloads shared by every desktop event adapter. */
export interface AppEventPayloads {
  [DESKTOP_EVENTS.PLUGINS_CHANGED]: null
  [DESKTOP_EVENTS.OPEN_MAIN_CHAT]: OpenMainChatEvent
  [DESKTOP_EVENTS.PARAMS_CHANGED]: InitParams
  [DESKTOP_EVENTS.CONTEXT_CAPTURED]: CapturedContext
  [DESKTOP_EVENTS.OPEN_MAIN_EDITOR]: EditorTransfer
  [DESKTOP_EVENTS.ACTIVATION_METRICS_START]: { id: number }
  [DESKTOP_EVENTS.ACTIVATION_METRICS_COLLECT]: { id: number }
  [DESKTOP_EVENTS.VOICE_AUDIO_LEVEL]: { level: number; peak: number }
  [DESKTOP_EVENTS.SELECTION_RUN]: SelectionRunEvent
  [DESKTOP_EVENTS.SELECTION_CANCEL]: { runId: number }
  [DESKTOP_EVENTS.COMMAND_RUN]: CommandRunEvent
  [DESKTOP_EVENTS.EXTERNAL_JOB_CANCEL]: string
  [DESKTOP_EVENTS.HOTKEYS_CHANGED]: null
  [DESKTOP_EVENTS.MAIN_WINDOW_CLOSED]: null
}

export interface OpenMainChatEvent {
  attachment?: ChatAttachment | null
  question?: string | null
  autoSend?: boolean
}

/** Rejects malformed externally delivered chat events before UI side effects. */
export function parseOpenMainChatEvent(value: unknown): OpenMainChatEvent {
  const record = (entry: unknown): entry is Record<string, unknown> =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !['attachment', 'question', 'autoSend'].includes(key)
    )
  )
    throw new Error('Invalid main chat event')
  if (value.question != null && typeof value.question !== 'string')
    throw new Error('Invalid chat question')
  if (value.autoSend !== undefined && typeof value.autoSend !== 'boolean')
    throw new Error('Invalid chat submit flag')
  if (value.attachment != null) {
    const attachment = value.attachment
    if (!record(attachment) || typeof attachment.text !== 'string')
      throw new Error('Invalid chat attachment')
    if (
      attachment.source !== undefined &&
      !['selection', 'editor-selection', 'editor-text'].includes(
        String(attachment.source)
      )
    )
      throw new Error('Invalid chat attachment source')
    for (const key of ['name', 'mediaType'])
      if (attachment[key] !== undefined && typeof attachment[key] !== 'string')
        throw new Error('Invalid chat attachment metadata')
  }
  return value as OpenMainChatEvent
}

export type DesktopListen = <K extends keyof AppEventPayloads>(
  event: K,
  handler: (payload: AppEventPayloads[K]) => void | Promise<void>
) => Promise<() => void>

export const DESKTOP_COMMANDS = {
  INSPECT_PLUGIN_PACKAGE: 'inspect_plugin_package',
  LIST_INSTALLED_PLUGINS: 'list_installed_plugins',
  INSTALL_PLUGIN_PACKAGE: 'install_plugin_package',
  RESTORE_PLUGIN_PACKAGE: 'restore_plugin_package',
  REMOVE_PLUGIN_PACKAGE: 'remove_plugin_package',
  GET_INIT_PARAMS: 'get_init_params',
  GET_STORAGE_INFO: 'get_storage_info',
  OPEN_STORAGE_LOCATION: 'open_storage_location',
  APPLY_HOTKEY: 'apply_hotkey',
  CONFIGURE_HOTKEYS: 'configure_hotkeys',
  REBIND_HOTKEYS: 'rebind_hotkeys',
  SUSPEND_HOTKEYS: 'suspend_hotkeys',
  GET_HOTKEY_PROVIDER_INFO: 'get_hotkey_provider_info',
  OPEN_MAIN_CHAT: 'open_main_chat',
  OPEN_MAIN_EDITOR: 'open_main_editor',
  MARK_ACTIVATION_METRIC: 'mark_activation_metric',
  SUBMIT_ACTIVATION_METRIC_VALUE: 'submit_activation_metric_value',
  SAVE_USER_CONFIG: 'save_user_config',
  PATCH_LOCAL_STATE: 'patch_local_state',
  GET_EDITOR_HISTORY: 'get_editor_history',
  GET_CHAT_HISTORY: 'get_chat_history',
  GET_CHAT: 'get_chat',
  STORE_CHAT_IMAGE: 'store_chat_image',
  GET_CHAT_IMAGE: 'get_chat_image',
  SYNC_CHAT_IMAGES: 'sync_chat_images',
  RELEASE_CHAT_IMAGE_UNDO: 'release_chat_image_undo',
  READ_CHAT_FILE: 'read_chat_file',
  SAVE_EDITOR_HISTORY: 'save_editor_history',
  SET_EDITOR_HISTORY_RESULT: 'set_editor_history_result',
  RESTORE_EDITOR_HISTORY_ITEM: 'restore_editor_history_item',
  SAVE_CHAT_HISTORY: 'save_chat_history',
  RENAME_CHAT: 'rename_chat',
  SEARCH_CHAT_HISTORY: 'search_chat_history',
  REMOVE_FROM_EDITOR_HISTORY: 'remove_from_editor_history',
  REMOVE_FROM_CHAT_HISTORY: 'remove_from_chat_history',
  CLEAR_EDITOR_HISTORY: 'clear_editor_history',
  CLEAR_CHAT_HISTORY: 'clear_chat_history',
  CLOSE_WINDOW: 'close_window',
  DISMISS_QUICK_WINDOW: 'dismiss_quick_window',
  SET_QUICK_INPUT_REGION: 'set_quick_input_region',
  OPEN_IN_BROWSER: 'open_in_browser',
  OPEN_IN_BROWSER_AND_CLOSE: 'open_in_browser_and_close',
  START_VOICE_CAPTURE: 'start_voice_capture',
  STOP_VOICE_CAPTURE: 'stop_voice_capture',
  TYPE_INTO_WINDOW_AND_CLOSE: 'type_into_window_and_close',
  SAVE_NOTE: 'save_note',
  APPEND_NOTE: 'append_note',
  NET_FETCH: 'net_fetch',
  NET_CANCEL: 'net_cancel',
  NET_SOCKET_OPEN: 'net_socket_open',
  NET_SOCKET_SEND_TEXT: 'net_socket_send_text',
  NET_SOCKET_SEND_BINARY: 'net_socket_send_binary',
  NET_SOCKET_CLOSE: 'net_socket_close',
  SECRETS_STATUS: 'secrets_status',
  SECRETS_VAULT_STATE: 'secrets_vault_state',
  SECRETS_SET: 'secrets_set',
  SECRETS_REMOVE: 'secrets_remove',
  ACTIVATE_MODE: 'activate_mode',
  FINISH_SELECTION_RUN: 'finish_selection_run',
  SHOW_STATUS_OVERLAY: 'show_status_overlay',
  NOTIFY_DESKTOP: 'notify_desktop',
  CHECK_TEXT_INJECTION: 'check_text_injection',
  EXECUTE_SCRIPT_ACTION: 'execute_script_action',
  CANCEL_SCRIPT_ACTION: 'cancel_script_action',
  PICK_SCRIPT_FILE: 'pick_script_file',
  PICK_DIRECTORY: 'pick_directory',
  LOG_CUSTOM_ACTION: 'log_custom_action',
  LOG_COMMAND_RUN: 'log_command_run',
  OPEN_ACTION_LOG: 'open_action_log',
  LOG_CLIENT_MESSAGE: 'log_client_message',
  SET_TOOL_CATALOG: 'set_tool_catalog',
  ANSWER_EXTERNAL_ACCESS: 'answer_external_access',
  CLAIM_EXTERNAL_JOB: 'claim_external_job',
  FINISH_EXTERNAL_JOB: 'finish_external_job',
  GET_USER_CONFIG: 'get_user_config',
  COPY_TEXT: 'copy_text',
  REPLACE_SELECTION_WITH_COMMAND: 'replace_selection_with_command',
} as const

export type DesktopCommandName =
  (typeof DESKTOP_COMMANDS)[keyof typeof DESKTOP_COMMANDS]

/** A script action to run; see `execute_script_action` */
export interface ScriptActionRequest {
  name: string
  command: string
  workingDir?: string
  text: string
  /** The output is used: the command is waited for longer */
  captureOutput: boolean
  /** How long the output is waited for, in seconds; absent for the default */
  timeoutSec?: number
  logOutput: boolean
  /** Lets `cancel_script_action` stop the command while it is waited for */
  runId?: string
}

/** The error of a script stopped with `cancel_script_action` */
export const SCRIPT_CANCELLED_ERROR = 'Cancelled'

/** Where a command or a tool is invoked from, also for the action log */
export type CommandRunSource =
  | 'menu'
  | 'toolbar'
  | 'launcher'
  | 'external'
  | 'chat'
  /** A selection run: the output replaces the selection it got */
  | 'selection'

/**
 * The command the command overlay opens with: an external call that needs a
 * text or the result menu
 */
export interface LauncherRequest {
  commandId: string
  jobId?: string
  output?: 'return' | 'configured'
  input?: Record<string, unknown>
  /** The text of the call; without it the selection or the field gives it */
  text?: string
}

/**
 * How a command of a tool gets its input from a text: none, the text as it is,
 * parsed by the tool, or a structured input only the LLM can fill
 */
export type ToolCatalogInput = 'none' | 'text' | 'parsed' | 'structured'

/**
 * A tool of the webview registry as the backend knows it; see
 * `set_tool_catalog`
 */
export interface ToolCatalogEntry {
  id: string
  input: ToolCatalogInput
  available: boolean
  /** Why the tool cannot run now, translated */
  reason?: string
  inputSchema?: Record<string, unknown>
}

/** An external call that runs a command in the background */
export interface CommandRunEvent {
  commandId: string
  jobId?: string
  output?: 'return' | 'configured'
  input?: Record<string, unknown>
  text?: string
  userConfig: UserConfig
}

/**
 * One run of a library command, written to the action log; see
 * `log_command_run`
 */
export interface CommandRunRecord {
  commandId: string
  name: string
  /** Where the command was invoked from */
  source: CommandRunSource
  /** Absent for a command that takes no text */
  text?: string
  success: boolean
  /** Why it failed */
  message?: string
}

export interface ScriptExecutionResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  /** The command did not finish while waited for and keeps running */
  running: boolean
}
