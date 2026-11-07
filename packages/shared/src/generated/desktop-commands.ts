// Generated from src-tauri by scripts/generate-desktop-commands.mjs.
// Do not edit: run pnpm generate:desktop.
import type {
  AccessDecision,
  ActivationMetricMark,
  ActivationMode,
  AiAttachedFile,
  AiFileChangePreview,
  AiFileRoot,
  AiFileToolOutput,
  AiFileToolRequest,
  AiProfile,
  AiProject,
  AiWebToolOutput,
  AiWebToolRequest,
  Chat,
  ChatAttachment,
  ChatAttachmentFile,
  ChatFileMeta,
  ChatImage,
  ChatImageMeta,
  ChatSummary,
  ClientLogLevel,
  CommandRunRecord,
  CropRect,
  DesktopSnapshot,
  EditorHistoryEntry,
  EditorHistoryItem,
  EditorHistoryOrigin,
  ExternalJob,
  FetchRequest,
  HotkeyApplyRequest,
  HotkeyApplyResult,
  HotkeyProviderInfo,
  InputRegion,
  InstalledPlugin,
  JobCompletion,
  PluginPackagePreview,
  ProfileMemoryChange,
  ProfileMemorySearchResult,
  ProfileMemoryTopic,
  ScreenshotCaptureMode,
  ScreenshotChatTransfer,
  ScriptActionRequest,
  ScriptExecutionResult,
  SecretStatus,
  SelectionFinishStatus,
  SessionStatePatch,
  SocketFrameMeta,
  SocketRequest,
  StatusOverlayRequest,
  StorageInfo,
  StorageKind,
  TextInsertionStatus,
  ToolCatalogEntry,
  UserDataRelocationMode,
  UserDataTarget,
  VaultState,
  VaultTarget,
  VoiceCaptureInfo,
} from './desktop-types'
import type { UserConfig } from '../user-config'

/** A channel object passed as a command argument; see `@tauri-apps/api/core` */
export interface DesktopChannel {
  readonly id: number
}

/**
 * The argument of a command that takes raw bytes: `bytes` go as the body,
 * `meta` beside them; see `BinaryRequest` in `src-tauri/src/ipc.rs`
 */
export interface BinaryArgs<M> {
  bytes: Uint8Array
  meta: M
}

/** Every command of the backend with its arguments and its result */
export interface DesktopCommands {
  acknowledge_fetch_chunk: { args: { id: number }; result: void }
  acknowledge_settings_shutdown: {
    args: { requestId: number; saved: boolean }
    result: void
  }
  activate_mode: {
    args: {
      mode: ActivationMode
      actionPageIndex?: number | null
      historyOrigin?: EditorHistoryOrigin | null
      text?: string | null
    }
    result: void
  }
  add_ai_profile_memory_fact: {
    args: {
      profileId: string
      chatId?: string | null
      file: string
      fact: string
    }
    result: ProfileMemoryChange
  }
  add_editor_history_item: {
    args: { entry: EditorHistoryEntry }
    result: string | null
  }
  add_screenshot: { args: { activationId: number }; result: ChatImage | null }
  answer_external_access: {
    args: { jobId: string; decision: AccessDecision }
    result: void
  }
  apply_hotkey: {
    args: { request: HotkeyApplyRequest }
    result: HotkeyApplyResult
  }
  cancel_net_task: { args: { id: number }; result: void }
  cancel_screenshot_crop: { args: { selectionId: number }; result: void }
  cancel_script_action: { args: { runId: string }; result: boolean }
  claim_external_job: { args: { id: string }; result: boolean }
  clear_ai_profile_memory: { args: { profileId: string }; result: void }
  clear_chats: { args: { profileId?: string | null }; result: void }
  clear_editor_history: { args: undefined; result: void }
  close_socket: {
    args: { id: number; finalMessage?: string | null }
    result: void
  }
  confirm_screenshot_crop: {
    args: { selectionId: number; crop: CropRect }
    result: void
  }
  copy_text: { args: { text: string }; result: void }
  create_ai_profile: {
    args: { profile: AiProfile; soul: string }
    result: void
  }
  create_ai_project: { args: { project: AiProject }; result: void }
  delete_ai_profile: { args: { id: string }; result: void }
  delete_ai_project: { args: { id: string }; result: void }
  delete_chat: {
    args: { id: string; profileId?: string | null }
    result: Chat | null
  }
  delete_editor_history_item: { args: { id: string }; result: void }
  delete_secret: { args: { id: string }; result: void }
  execute_script_action: {
    args: { request: ScriptActionRequest }
    result: ScriptExecutionResult
  }
  export_chat_file: {
    args: { id: string; name: string; profileId?: string | null }
    result: boolean
  }
  finish_external_job: {
    args: { id: string; completion: JobCompletion }
    result: ExternalJob | null
  }
  finish_selection_run: {
    args: { runId: number; text?: string | null }
    result: SelectionFinishStatus
  }
  get_ai_profile: { args: { id: string }; result: AiProfile }
  get_ai_vault_path: { args: undefined; result: string }
  get_chat: {
    args: { id: string; importId?: string | null; profileId?: string | null }
    result: Chat | null
  }
  get_desktop_state: { args: undefined; result: DesktopSnapshot }
  get_editor_history: { args: undefined; result: Array<EditorHistoryItem> }
  get_hotkey_provider_info: { args: undefined; result: HotkeyProviderInfo }
  get_secret_statuses: { args: undefined; result: Record<string, SecretStatus> }
  get_secret_vault_state: { args: undefined; result: VaultState }
  get_storage_info: { args: undefined; result: StorageInfo }
  get_text_insertion_status: { args: undefined; result: TextInsertionStatus }
  hide_quick_window_on_blur: { args: { activationId: number }; result: void }
  hide_window: { args: { activationId: number }; result: void }
  inspect_ai_vault_target: {
    args: { path?: string | null }
    result: VaultTarget
  }
  inspect_user_data_target: {
    args: { path?: string | null }
    result: UserDataTarget
  }
  install_plugin_package: {
    args: { inspectionId: string }
    result: InstalledPlugin
  }
  list_ai_file_roots: {
    args: { profileId?: string | null; attachments: Array<AiAttachedFile> }
    result: Array<AiFileRoot>
  }
  list_ai_profile_memory_topics: {
    args: { profileId: string }
    result: Array<ProfileMemoryTopic>
  }
  list_ai_profiles: { args: undefined; result: Array<AiProfile> }
  list_ai_projects: { args: undefined; result: Array<AiProject> }
  list_chats: {
    args: { profileId?: string | null }
    result: Array<ChatSummary>
  }
  list_installed_plugins: { args: undefined; result: Array<InstalledPlugin> }
  list_recent_quick_request_prompts: {
    args: { profileId?: string | null; limit: number }
    result: Array<string>
  }
  log_client_message: {
    args: { level: ClientLogLevel; message: string; context?: string | null }
    result: void
  }
  log_command_run: { args: { record: CommandRunRecord }; result: void }
  log_webhook_call: { args: { name: string; details: string }; result: void }
  mark_activation_metric: {
    args: { id: number; mark: ActivationMetricMark }
    result: void
  }
  open_action_log: { args: undefined; result: boolean }
  open_ai_vault_location: { args: { profileId?: string | null }; result: void }
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
      profileId?: string | null
      chatId?: string | null
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
  open_screenshot_chat: {
    args: { transfer: ScreenshotChatTransfer; activationId: number }
    result: void
  }
  open_socket: {
    args: { request: SocketRequest; onEvent: DesktopChannel }
    result: number
  }
  open_storage_location: { args: { kind: StorageKind }; result: void }
  open_system_hotkey_settings: { args: undefined; result: void }
  paste_into_target_and_hide: {
    args: { activationId: number; text: string }
    result: void
  }
  patch_session_state: {
    args: { patch: SessionStatePatch }
    result: DesktopSnapshot
  }
  pick_directory: { args: undefined; result: string | null }
  pick_file: { args: undefined; result: string | null }
  pick_plugin_package: { args: undefined; result: PluginPackagePreview | null }
  pick_script_file: { args: undefined; result: string | null }
  preview_ai_file_change: {
    args: {
      profileId?: string | null
      attachments: Array<AiAttachedFile>
      request: AiFileToolRequest
    }
    result: AiFileChangePreview
  }
  read_ai_file_bytes: {
    args: {
      profileId?: string | null
      attachments: Array<AiAttachedFile>
      path: string
    }
    result: ArrayBuffer
  }
  read_ai_profile_memory: {
    args: { profileId: string; file: string }
    result: string
  }
  read_ai_profile_soul: { args: { id: string }; result: string }
  read_chat_file: {
    args: { id: string; profileId?: string | null }
    result: ArrayBuffer
  }
  read_chat_image: {
    args: { id: string; profileId?: string | null }
    result: ArrayBuffer
  }
  read_dropped_file: { args: { path: string }; result: ArrayBuffer }
  rebind_hotkeys: { args: undefined; result: void }
  release_deleted_chat_images: { args: { id: string }; result: void }
  relocate_ai_vault: {
    args: { path?: string | null; moveData: boolean }
    result: void
  }
  relocate_user_data: {
    args: { mode: UserDataRelocationMode; path?: string | null }
    result: void
  }
  remove_screenshot: {
    args: { activationId: number; imageId?: string | null }
    result: void
  }
  rename_chat: {
    args: { id: string; title: string; profileId?: string | null }
    result: void
  }
  replace_ai_profile_memory: {
    args: {
      profileId: string
      chatId?: string | null
      file: string
      oldText: string
      newText: string
    }
    result: ProfileMemoryChange
  }
  replace_selection_with_command: { args: { commandId: string }; result: void }
  request_text_insertion_permission: {
    args: undefined
    result: TextInsertionStatus
  }
  restart_app: { args: undefined; result: void }
  restore_editor_history_item: {
    args: { item: EditorHistoryItem }
    result: void
  }
  restore_previous_plugin_package: { args: { id: string }; result: void }
  retake_screenshot: {
    args: { activationId: number; mode?: ScreenshotCaptureMode | null }
    result: ChatImage | null
  }
  reveal_quick_window: { args: { activationId: number }; result: void }
  rewrite_ai_profile_memory: {
    args: {
      profileId: string
      chatId?: string | null
      file: string
      content: string
    }
    result: ProfileMemoryChange
  }
  run_ai_file_tool: {
    args: {
      profileId?: string | null
      attachments: Array<AiAttachedFile>
      request: AiFileToolRequest
    }
    result: AiFileToolOutput
  }
  run_ai_web_tool: {
    args: { profileId: string; request: AiWebToolRequest }
    result: AiWebToolOutput
  }
  save_ai_profile: { args: { profile: AiProfile }; result: void }
  save_ai_project: { args: { project: AiProject }; result: void }
  save_chat: { args: { chat: Chat; profileId?: string | null }; result: void }
  save_chat_file_to_workspace: {
    args: { profileId: string; fileId: string; name: string }
    result: string
  }
  save_user_config: {
    args: { userConfig: UserConfig; baseConfig: UserConfig }
    result: DesktopSnapshot
  }
  search_ai_profile_memory: {
    args: { profileId: string; query: string }
    result: Array<ProfileMemorySearchResult>
  }
  search_chats: {
    args: { query: string; profileId?: string | null }
    result: Array<string>
  }
  send_socket_binary: { args: BinaryArgs<SocketFrameMeta>; result: void }
  send_socket_text: { args: { id: number; text: string }; result: void }
  set_editor_history_item_result: {
    args: { id: string; result: string }
    result: void
  }
  set_quick_input_region: {
    args: { region?: InputRegion | null; activationId: number }
    result: void
  }
  set_secret: {
    args: { id: string; value: string; origins?: Array<string> | null }
    result: void
  }
  set_tool_catalog: { args: { tools: Array<ToolCatalogEntry> }; result: void }
  set_tray_menu_labels: {
    args: { showLabel: string; quitLabel: string; tooltipLabel?: string | null }
    result: void
  }
  show_desktop_notification: {
    args: { summary: string; body: string }
    result: void
  }
  show_status_overlay: {
    args: { request?: StatusOverlayRequest | null }
    result: void
  }
  start_fetch: {
    args: { request: FetchRequest; onEvent: DesktopChannel }
    result: number
  }
  start_voice_capture: {
    args: { onAudio: DesktopChannel }
    result: VoiceCaptureInfo
  }
  stop_voice_capture: { args: { sessionId?: number | null }; result: void }
  store_chat_file: {
    args: BinaryArgs<ChatFileMeta>
    result: ChatAttachmentFile
  }
  store_chat_image: { args: BinaryArgs<ChatImageMeta>; result: ChatImage }
  submit_activation_metric_value: {
    args: { id: number; value: string }
    result: void
  }
  suspend_hotkeys: { args: { suspended: boolean }; result: void }
  sync_chat_images: {
    args: {
      ids: Array<string>
      importIds: Array<string>
      profileId?: string | null
    }
    result: void
  }
  undo_ai_profile_memory: {
    args: { profileId: string; chatId?: string | null; file: string }
    result: ProfileMemoryChange
  }
  uninstall_plugin_package: { args: { id: string }; result: void }
  write_ai_profile_soul: { args: { id: string; content: string }; result: void }
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
}

export type DesktopCommandName = keyof DesktopCommands
export type DesktopCommandArgs<K extends DesktopCommandName> =
  DesktopCommands[K]['args']
export type DesktopCommandResult<K extends DesktopCommandName> =
  DesktopCommands[K]['result']

/** The commands whose argument is `BinaryArgs` */
export const BINARY_DESKTOP_COMMANDS = [
  'send_socket_binary',
  'store_chat_file',
  'store_chat_image',
] as const satisfies readonly DesktopCommandName[]

/** The commands that act for an activation and name it by `activationId` */
export const ACTIVATION_DESKTOP_COMMANDS = [
  'add_screenshot',
  'hide_quick_window_on_blur',
  'hide_window',
  'open_in_browser_and_hide',
  'open_main_chat',
  'open_main_editor',
  'open_screenshot_chat',
  'paste_into_target_and_hide',
  'remove_screenshot',
  'retake_screenshot',
  'reveal_quick_window',
  'set_quick_input_region',
] as const satisfies readonly DesktopCommandName[]
