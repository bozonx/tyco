import { APP_CONFIG, type AppConfig } from './app-config'
import { DEFAULT_USER_CONFIG, type UserConfig } from './user-config'

export interface IpcResult<T = unknown> {
  success: boolean
  error?: string
  result?: T
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'developer'
  content: string
  attachments?: string[]
  status?: 'complete' | 'stopped'
}

export enum START_MODES {
  SELECT = 'select',
  VOICE = 'voice',
  AI_TASKS = 'aiTasks',
  CORRECTION = 'correction',
  EDITOR = 'editor',
  WRITE = 'write',
  CHAT = 'chat',
  VOICE_CHAT = 'voiceChat',
  HISTORY = 'history',
  CONFIG = 'config',
}

export interface ChatParams {
  id?: string
  /** The title the chat has in the history */
  title?: string
  attachments?: string[]
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
}

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
} as const

export const DESKTOP_COMMANDS = {
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
  OPEN_IN_BROWSER_AND_CLOSE: 'open_in_browser_and_close',
  START_VOICE_CAPTURE: 'start_voice_capture',
  STOP_VOICE_CAPTURE: 'stop_voice_capture',
  TYPE_INTO_WINDOW_AND_CLOSE: 'type_into_window_and_close',
  PUT_INTO_CLIPBOARD_AND_CLOSE: 'put_into_clipboard_and_close',
  SAVE_NOTE: 'save_note',
  APPEND_NOTE: 'append_note',
  NET_FETCH: 'net_fetch',
  NET_CANCEL: 'net_cancel',
  NET_SOCKET_OPEN: 'net_socket_open',
  NET_SOCKET_SEND_TEXT: 'net_socket_send_text',
  NET_SOCKET_SEND_BINARY: 'net_socket_send_binary',
  NET_SOCKET_CLOSE: 'net_socket_close',
  SECRETS_STATUS: 'secrets_status',
  SECRETS_SET: 'secrets_set',
  SECRETS_REMOVE: 'secrets_remove',
  ACTIVATE_MODE: 'activate_mode',
  FINISH_SELECTION_RUN: 'finish_selection_run',
  SHOW_STATUS_OVERLAY: 'show_status_overlay',
  NOTIFY_DESKTOP: 'notify_desktop',
  CHECK_TEXT_INJECTION: 'check_text_injection',
  EXECUTE_SCRIPT_ACTION: 'execute_script_action',
  PICK_SCRIPT_FILE: 'pick_script_file',
  PICK_DIRECTORY: 'pick_directory',
  LOG_CUSTOM_ACTION: 'log_custom_action',
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
  logOutput: boolean
}

export interface ScriptExecutionResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  /** The command did not finish while waited for and keeps running */
  running: boolean
}
