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
}

export enum START_MODES {
  SELECT = 'select',
  VOICE = 'voice',
  AI_TASKS = 'aiTasks',
  EDITOR = 'editor',
  WRITE = 'write',
  CHAT = 'chat',
  HISTORY = 'history',
  CONFIG = 'config',
}

export interface ChatParams {
  id?: string
  initialMessage?: string
  initialRule?: string
  attachments?: string[]
}

export interface ChatHistoryItem {
  id: string
  description: string
  lastMsgDate: string
  messages: ChatMessage[]
}

export interface StorageInfo {
  configDir: string
  dataDir: string
  historyDir: string
  chatsDir: string
  cacheDir: string
  userConfigFile: string
}

export interface LocalState {
  lastChatId?: string | null
  lastMode?: START_MODES | null
}

export const DEFAULT_LOCAL_STATE: LocalState = { lastChatId: null }

export interface InitParams {
  windowId: string | null
  selectedText: string | null
  mode: START_MODES | null
  userConfig: UserConfig
  localState: LocalState
  appConfig: AppConfig
  NODE_ENV: string
  isWindowShown: boolean
}

export type CapturedContext = Pick<InitParams, 'selectedText'>

export const DEFAULT_INIT_PARAMS: InitParams = {
  windowId: null,
  selectedText: null,
  mode: START_MODES.EDITOR,
  userConfig: DEFAULT_USER_CONFIG,
  localState: DEFAULT_LOCAL_STATE,
  appConfig: APP_CONFIG,
  NODE_ENV: 'development',
  isWindowShown: true,
}

export const DESKTOP_EVENTS = {
  PARAMS_CHANGED: 'app://params-changed',
  CONTEXT_CAPTURED: 'app://context-captured',
  VOICE_TEXT: 'app://voice-text',
} as const

export const DESKTOP_COMMANDS = {
  GET_INIT_PARAMS: 'get_init_params',
  GET_STORAGE_INFO: 'get_storage_info',
  SAVE_USER_CONFIG: 'save_user_config',
  SAVE_LOCAL_STATE: 'save_local_state',
  GET_EDITOR_HISTORY: 'get_editor_history',
  GET_TRANSFORM_HISTORY: 'get_transform_history',
  GET_CHAT_HISTORY: 'get_chat_history',
  GET_CHAT: 'get_chat',
  SAVE_MAIN_INPUT_TMP: 'save_main_input_tmp',
  CLEAR_MAIN_INPUT_TMP: 'clear_main_input_tmp',
  SAVE_EDITOR_HISTORY: 'save_editor_history',
  SAVE_TRANSFORM_HISTORY: 'save_transform_history',
  SAVE_CHAT_HISTORY: 'save_chat_history',
  REMOVE_FROM_EDITOR_HISTORY: 'remove_from_editor_history',
  REMOVE_FROM_TRANSFORM_HISTORY: 'remove_from_transform_history',
  REMOVE_FROM_CHAT_HISTORY: 'remove_from_chat_history',
  CLEAR_EDITOR_HISTORY: 'clear_editor_history',
  CLEAR_TRANSFORM_HISTORY: 'clear_transform_history',
  CLEAR_CHAT_HISTORY: 'clear_chat_history',
  CLOSE_WINDOW: 'close_window',
  OPEN_IN_BROWSER_AND_CLOSE: 'open_in_browser_and_close',
  START_VOICE_RECOGNITION: 'start_voice_recognition',
  STOP_VOICE_RECOGNITION: 'stop_voice_recognition',
  START_LOCAL_VOICE_RECORDING: 'start_local_voice_recording',
  STOP_LOCAL_VOICE_RECORDING: 'stop_local_voice_recording',
  TYPE_INTO_WINDOW_AND_CLOSE: 'type_into_window_and_close',
  PUT_INTO_CLIPBOARD_AND_CLOSE: 'put_into_clipboard_and_close',
} as const

export type DesktopCommandName =
  (typeof DESKTOP_COMMANDS)[keyof typeof DESKTOP_COMMANDS]
