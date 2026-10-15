// Generated from src-tauri/src/commands by scripts/generate-desktop-commands.mjs.
// Do not edit: run pnpm generate:desktop.
import type {
  AccessDecision,
  AiProfile,
  AiProject,
  Chat,
  ChatAttachment,
  ChatImage,
  ChatSummary,
  CommandRunRecord,
  DesktopChannel,
  DesktopSnapshot,
  EditorHistoryEntry,
  EditorHistoryItem,
  ExternalJob,
  FetchRequest,
  HotkeyApplyRequest,
  HotkeyApplyResult,
  HotkeyProviderInfo,
  InputRect,
  InstalledPluginPackage,
  JobCompletion,
  PluginPackagePreview,
  ScriptActionRequest,
  ScriptExecutionResult,
  SecretStatus,
  SelectionFinishStatus,
  SessionState,
  SocketRequest,
  StatusOverlayRequest,
  StorageInfo,
  StorageKind,
  ToolCatalogEntry,
  UserConfig,
  VaultState,
  VoiceCaptureInfo,
} from './index'
import type { PluginManifest } from '@tyco/plugin-sdk'

export const DESKTOP_COMMANDS = {
  ACKNOWLEDGE_SETTINGS_SHUTDOWN: 'acknowledge_settings_shutdown',
  ACTIVATE_MODE: 'activate_mode',
  ANSWER_EXTERNAL_ACCESS: 'answer_external_access',
  APPEND_NOTE: 'append_note',
  APPLY_HOTKEY: 'apply_hotkey',
  CANCEL_SCRIPT_ACTION: 'cancel_script_action',
  CHECK_TEXT_INJECTION: 'check_text_injection',
  CLAIM_EXTERNAL_JOB: 'claim_external_job',
  CLEAR_CHATS: 'clear_chats',
  CLEAR_EDITOR_HISTORY: 'clear_editor_history',
  CLEAR_PROFILE_CHATS: 'clear_profile_chats',
  CONFIGURE_HOTKEYS: 'configure_hotkeys',
  COPY_TEXT: 'copy_text',
  DELETE_AI_PROFILE: 'delete_ai_profile',
  DELETE_AI_PROJECT: 'delete_ai_project',
  DELETE_CHAT: 'delete_chat',
  DELETE_PROFILE_CHAT: 'delete_profile_chat',
  DISMISS_QUICK_WINDOW: 'dismiss_quick_window',
  EXECUTE_SCRIPT_ACTION: 'execute_script_action',
  FINISH_EXTERNAL_JOB: 'finish_external_job',
  FINISH_SELECTION_RUN: 'finish_selection_run',
  GET_AI_VAULT_PATH: 'get_ai_vault_path',
  GET_CHAT: 'get_chat',
  GET_CHAT_IMAGE: 'get_chat_image',
  GET_DESKTOP_STATE: 'get_desktop_state',
  GET_EDITOR_HISTORY: 'get_editor_history',
  GET_HOTKEY_PROVIDER_INFO: 'get_hotkey_provider_info',
  GET_PROFILE_CHAT: 'get_profile_chat',
  GET_STORAGE_INFO: 'get_storage_info',
  GET_USER_CONFIG: 'get_user_config',
  HIDE_WINDOW: 'hide_window',
  INSPECT_PLUGIN_PACKAGE: 'inspect_plugin_package',
  INSTALL_PLUGIN_PACKAGE: 'install_plugin_package',
  LIST_AI_PROFILES: 'list_ai_profiles',
  LIST_AI_PROJECTS: 'list_ai_projects',
  LIST_CHATS: 'list_chats',
  LIST_INSTALLED_PLUGINS: 'list_installed_plugins',
  LIST_PROFILE_CHATS: 'list_profile_chats',
  LOG_CLIENT_MESSAGE: 'log_client_message',
  LOG_COMMAND_RUN: 'log_command_run',
  LOG_CUSTOM_ACTION: 'log_custom_action',
  MARK_ACTIVATION_METRIC: 'mark_activation_metric',
  NET_CANCEL: 'net_cancel',
  NET_FETCH: 'net_fetch',
  NET_FETCH_ACK: 'net_fetch_ack',
  NET_SOCKET_CLOSE: 'net_socket_close',
  NET_SOCKET_OPEN: 'net_socket_open',
  NET_SOCKET_SEND_BINARY: 'net_socket_send_binary',
  NET_SOCKET_SEND_TEXT: 'net_socket_send_text',
  NOTIFY_DESKTOP: 'notify_desktop',
  OPEN_ACTION_LOG: 'open_action_log',
  OPEN_FOLDER_IN_OS: 'open_folder_in_os',
  OPEN_IN_BROWSER: 'open_in_browser',
  OPEN_IN_BROWSER_AND_HIDE: 'open_in_browser_and_hide',
  OPEN_MAIN_CHAT: 'open_main_chat',
  OPEN_MAIN_EDITOR: 'open_main_editor',
  OPEN_STORAGE_LOCATION: 'open_storage_location',
  PASTE_INTO_TARGET_AND_HIDE: 'paste_into_target_and_hide',
  PATCH_SESSION_STATE: 'patch_session_state',
  PICK_DIRECTORY: 'pick_directory',
  PICK_EXTERNAL_PROJECT_FOLDER: 'pick_external_project_folder',
  PICK_SCRIPT_FILE: 'pick_script_file',
  READ_CHAT_FILE: 'read_chat_file',
  READ_PROFILE_SOUL: 'read_profile_soul',
  REBIND_HOTKEYS: 'rebind_hotkeys',
  RELEASE_CHAT_IMAGE_UNDO: 'release_chat_image_undo',
  REMOVE_FROM_EDITOR_HISTORY: 'remove_from_editor_history',
  REMOVE_PLUGIN_PACKAGE: 'remove_plugin_package',
  RENAME_CHAT: 'rename_chat',
  RENAME_PROFILE_CHAT: 'rename_profile_chat',
  REPLACE_SELECTION_WITH_COMMAND: 'replace_selection_with_command',
  RESTORE_EDITOR_HISTORY_ITEM: 'restore_editor_history_item',
  RESTORE_PLUGIN_PACKAGE: 'restore_plugin_package',
  SAVE_AI_PROFILE: 'save_ai_profile',
  SAVE_AI_PROJECT: 'save_ai_project',
  SAVE_CHAT: 'save_chat',
  SAVE_EDITOR_HISTORY: 'save_editor_history',
  SAVE_NOTE: 'save_note',
  SAVE_PROFILE_CHAT: 'save_profile_chat',
  SAVE_USER_CONFIG: 'save_user_config',
  SEARCH_CHATS: 'search_chats',
  SECRETS_REMOVE: 'secrets_remove',
  SECRETS_SET: 'secrets_set',
  SECRETS_STATUS: 'secrets_status',
  SECRETS_VAULT_STATE: 'secrets_vault_state',
  SET_EDITOR_HISTORY_RESULT: 'set_editor_history_result',
  SET_QUICK_INPUT_REGION: 'set_quick_input_region',
  SET_TOOL_CATALOG: 'set_tool_catalog',
  SHOW_STATUS_OVERLAY: 'show_status_overlay',
  START_VOICE_CAPTURE: 'start_voice_capture',
  STOP_VOICE_CAPTURE: 'stop_voice_capture',
  STORE_CHAT_IMAGE: 'store_chat_image',
  SUBMIT_ACTIVATION_METRIC_VALUE: 'submit_activation_metric_value',
  SUSPEND_HOTKEYS: 'suspend_hotkeys',
  SYNC_CHAT_IMAGES: 'sync_chat_images',
  WRITE_PLUGIN_NOTE: 'write_plugin_note',
  WRITE_PROFILE_SOUL: 'write_profile_soul',
} as const

export interface DesktopCommands {
  acknowledge_settings_shutdown: {
    args: { requestId: number; saved: boolean }
    result: void
  }
  activate_mode: { args: { mode: string; text?: string | null }; result: void }
  answer_external_access: {
    args: { jobId: string; decision: AccessDecision }
    result: void
  }
  append_note: {
    args: { dir: string; fileName: string; text: string }
    result: string
  }
  apply_hotkey: {
    args: { request: HotkeyApplyRequest }
    result: HotkeyApplyResult
  }
  cancel_script_action: { args: { runId: string }; result: boolean }
  check_text_injection: { args: undefined; result: void }
  claim_external_job: { args: { id: string }; result: boolean }
  clear_chats: { args: undefined; result: void }
  clear_editor_history: { args: undefined; result: void }
  clear_profile_chats: { args: { profileId: string }; result: void }
  configure_hotkeys: { args: undefined; result: void }
  copy_text: { args: { text: string }; result: void }
  delete_ai_profile: { args: { id: string }; result: void }
  delete_ai_project: { args: { id: string }; result: void }
  delete_chat: { args: { id: string }; result: void }
  delete_profile_chat: { args: { profileId: string; id: string }; result: void }
  dismiss_quick_window: { args: { activationId: number }; result: void }
  execute_script_action: {
    args: { request: ScriptActionRequest }
    result: ScriptExecutionResult
  }
  finish_external_job: {
    args: { id: string; completion: JobCompletion }
    result: ExternalJob | null
  }
  finish_selection_run: {
    args: { runId: number; text?: string | null }
    result: SelectionFinishStatus
  }
  get_ai_vault_path: { args: undefined; result: string }
  get_chat: { args: { id: string; lease?: string | null }; result: Chat | null }
  get_chat_image: { args: { id: string }; result: ArrayBuffer | number[] }
  get_desktop_state: { args: undefined; result: DesktopSnapshot }
  get_editor_history: { args: undefined; result: Array<EditorHistoryItem> }
  get_hotkey_provider_info: { args: undefined; result: HotkeyProviderInfo }
  get_profile_chat: {
    args: { profileId: string; id: string }
    result: Chat | null
  }
  get_storage_info: { args: undefined; result: StorageInfo }
  get_user_config: { args: undefined; result: UserConfig }
  hide_window: { args: { activationId: number }; result: void }
  inspect_plugin_package: {
    args: undefined
    result: PluginPackagePreview | null
  }
  install_plugin_package: {
    args: { path: string; manifest: PluginManifest; digest: string }
    result: InstalledPluginPackage
  }
  list_ai_profiles: { args: undefined; result: Array<AiProfile> }
  list_ai_projects: { args: undefined; result: Array<AiProject> }
  list_chats: { args: undefined; result: Array<ChatSummary> }
  list_installed_plugins: {
    args: undefined
    result: Array<InstalledPluginPackage>
  }
  list_profile_chats: {
    args: { profileId: string }
    result: Array<ChatSummary>
  }
  log_client_message: {
    args: { level: string; message: string; context?: string | null }
    result: void
  }
  log_command_run: { args: { record: CommandRunRecord }; result: void }
  log_custom_action: {
    args: { name: string; actionType: string; details: string }
    result: void
  }
  mark_activation_metric: { args: { id: number; mark: string }; result: void }
  net_cancel: { args: { id: number }; result: void }
  net_fetch: {
    args: { request: FetchRequest; onEvent: DesktopChannel }
    result: number
  }
  net_fetch_ack: { args: { id: number }; result: void }
  net_socket_close: {
    args: { id: number; payload?: string | null }
    result: void
  }
  net_socket_open: {
    args: { request: SocketRequest; onEvent: DesktopChannel }
    result: number
  }
  net_socket_send_binary: { args: Uint8Array; result: void }
  net_socket_send_text: { args: { id: number; text: string }; result: void }
  notify_desktop: { args: { summary: string; body: string }; result: void }
  open_action_log: { args: undefined; result: boolean }
  open_folder_in_os: { args: { path: string }; result: void }
  open_in_browser: { args: { url: string }; result: void }
  open_in_browser_and_hide: {
    args: { url: string; activationId: number }
    result: void
  }
  open_main_chat: {
    args: {
      attachment?: ChatAttachment | null
      question?: string | null
      autoSend?: boolean | null
      activationId: number
    }
    result: void
  }
  open_main_editor: {
    args: {
      text?: string | null
      sourceText?: string | null
      activationId: number
    }
    result: void
  }
  open_storage_location: { args: { kind: StorageKind }; result: void }
  paste_into_target_and_hide: {
    args: { activationId: number; text: string }
    result: void
  }
  patch_session_state: {
    args: { patch: Partial<SessionState> }
    result: DesktopSnapshot
  }
  pick_directory: { args: undefined; result: string | null }
  pick_external_project_folder: { args: undefined; result: string | null }
  pick_script_file: { args: undefined; result: string | null }
  read_chat_file: { args: { path: string }; result: ArrayBuffer | number[] }
  read_profile_soul: { args: { id: string }; result: string }
  rebind_hotkeys: { args: undefined; result: void }
  release_chat_image_undo: { args: { id: string }; result: void }
  remove_from_editor_history: { args: { id: string }; result: void }
  remove_plugin_package: { args: { id: string }; result: void }
  rename_chat: { args: { id: string; title: string }; result: void }
  rename_profile_chat: {
    args: { profileId: string; id: string; title: string }
    result: void
  }
  replace_selection_with_command: { args: { commandId: string }; result: void }
  restore_editor_history_item: {
    args: { item: EditorHistoryItem }
    result: void
  }
  restore_plugin_package: { args: { id: string }; result: void }
  save_ai_profile: { args: { profile: AiProfile }; result: void }
  save_ai_project: { args: { project: AiProject }; result: void }
  save_chat: { args: { chat: Chat }; result: void }
  save_editor_history: {
    args: { entry: EditorHistoryEntry }
    result: string | null
  }
  save_note: {
    args: { dir: string; fileName: string; text: string }
    result: string
  }
  save_profile_chat: { args: { profileId: string; chat: Chat }; result: void }
  save_user_config: {
    args: { userConfig: UserConfig; baseConfig: UserConfig }
    result: DesktopSnapshot
  }
  search_chats: { args: { query: string }; result: Array<string> }
  secrets_remove: { args: { id: string }; result: void }
  secrets_set: {
    args: { id: string; value: string; origins?: Array<string> | null }
    result: void
  }
  secrets_status: { args: undefined; result: Record<string, SecretStatus> }
  secrets_vault_state: { args: undefined; result: VaultState }
  set_editor_history_result: {
    args: { id: string; result: string }
    result: void
  }
  set_quick_input_region: {
    args: { region?: InputRect | null; activationId: number }
    result: void
  }
  set_tool_catalog: { args: { tools: Array<ToolCatalogEntry> }; result: void }
  show_status_overlay: {
    args: { request?: StatusOverlayRequest | null }
    result: void
  }
  start_voice_capture: {
    args: { onAudio: DesktopChannel }
    result: VoiceCaptureInfo
  }
  stop_voice_capture: { args: { sessionId?: number | null }; result: void }
  store_chat_image: { args: Uint8Array; result: ChatImage }
  submit_activation_metric_value: {
    args: { id: number; value: string }
    result: void
  }
  suspend_hotkeys: { args: { suspended: boolean }; result: void }
  sync_chat_images: {
    args: { ids: Array<string>; leases: Array<string> }
    result: void
  }
  write_plugin_note: {
    args: {
      pluginId: string
      dir: string
      fileName: string
      text: string
      append: boolean
    }
    result: string
  }
  write_profile_soul: { args: { id: string; content: string }; result: void }
}

export type DesktopCommandName = keyof DesktopCommands
export type DesktopCommandArgs<K extends DesktopCommandName> =
  DesktopCommands[K]['args']
export type DesktopCommandResult<K extends DesktopCommandName> =
  DesktopCommands[K]['result']
export type DesktopInvokeArgs<K extends DesktopCommandName> =
  DesktopCommandArgs<K> extends undefined
    ? [args?: undefined]
    : [args: DesktopCommandArgs<K>]
export type DesktopInvoke = <K extends DesktopCommandName>(
  command: K,
  ...args: [
    ...DesktopInvokeArgs<K>,
    options?: { headers: Record<string, string> },
  ]
) => Promise<DesktopCommandResult<K>>
