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
  AudioInputDevice,
  CaptureSource,
  Chat,
  ChatAttachment,
  ChatAttachmentFile,
  ChatFileMeta,
  ChatImage,
  ChatImageMeta,
  ChatSummary,
  ChatTransfer,
  ClientLogLevel,
  CommandRunPayload,
  CommandRunRecord,
  CropRect,
  DesktopSnapshot,
  Dialog,
  DialogSummary,
  EditorHistoryEntry,
  EditorHistoryFailure,
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
  MovedEntity,
  OperationCatalogEntry,
  PluginPackagePreview,
  ProfileMemoryChange,
  ProfileMemorySearchResult,
  ProfileMemoryTopic,
  ProfileSoul,
  ProjectConversion,
  ProjectTransferPreview,
  QuietRunEvent,
  QuietRunLabels,
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
  SubtitlesAction,
  SubtitlesSnapshot,
  SubtitlesView,
  TextInsertionStatus,
  ToolCallContext,
  UserDataRelocationMode,
  UserDataTarget,
  VaultChatHistory,
  VaultFolder,
  VaultInfo,
  VaultState,
  VoiceCaptureInfo,
  WindowGeometry,
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
      settingsTab?: string | null
      actionOrigin?: ActivationMode | null
    }
    result: void
  }
  add_ai_profile_memory_fact: {
    args: {
      profileId: string
      chatId?: string | null
      file: string
      fact: string
      section?: string | null
      description?: string | null
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
  attach_ai_vault: { args: { path: string; name: string }; result: VaultInfo }
  cancel_ai_web_tool: { args: { runId: string }; result: boolean }
  cancel_external_job: { args: { id: string }; result: void }
  cancel_net_task: { args: { id: number }; result: void }
  cancel_screenshot_crop: {
    args: { selectionId: number; closeAll?: boolean | null }
    result: void
  }
  cancel_script_action: { args: { runId: string }; result: boolean }
  capture_chat_screenshot: {
    args: { importId: string }
    result: ChatImage | null
  }
  check_dialog_recordings: {
    args: { dialogId: string; files: Array<string> }
    result: Array<boolean>
  }
  claim_external_job: { args: { id: string }; result: CommandRunPayload | null }
  clear_ai_profile_memory: { args: { profileId: string }; result: void }
  clear_chats: { args: { profileId?: string | null }; result: void }
  clear_dialogs: { args: undefined; result: void }
  clear_editor_history: { args: undefined; result: void }
  close_socket: {
    args: { id: number; finalMessage?: string | null }
    result: void
  }
  confirm_screenshot_crop: {
    args: { selectionId: number; crop: CropRect }
    result: void
  }
  convert_ai_project: {
    args: {
      id: string
      targetPath?: string | null
      transferFiles: boolean
      trashSource: boolean
      expectedRevision?: string | null
    }
    result: ProjectConversion
  }
  copy_text: { args: { text: string }; result: void }
  create_ai_profile: {
    args: { profile: AiProfile; soul: string }
    result: string
  }
  create_ai_project: { args: { project: AiProject }; result: string }
  delete_ai_profile: { args: { id: string }; result: void }
  delete_ai_project: { args: { id: string }; result: void }
  delete_chat: {
    args: { id: string; profileId?: string | null }
    result: Chat | null
  }
  delete_dialog: { args: { id: string }; result: Dialog | null }
  delete_editor_history_item: { args: { id: string }; result: void }
  delete_secret: { args: { id: string }; result: void }
  detach_ai_vault: { args: { vaultId: string }; result: void }
  discard_dialog_recording: {
    args: { dialogId: string; file: string }
    result: void
  }
  execute_script_action: {
    args: { request: ScriptActionRequest }
    result: ScriptExecutionResult
  }
  exit_app: { args: undefined; result: void }
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
  get_chat: {
    args: { id: string; importId?: string | null; profileId?: string | null }
    result: Chat | null
  }
  get_desktop_state: { args: undefined; result: DesktopSnapshot }
  get_dialog: { args: { id: string }; result: Dialog | null }
  get_editor_history: { args: undefined; result: Array<EditorHistoryItem> }
  get_hotkey_provider_info: { args: undefined; result: HotkeyProviderInfo }
  get_quiet_run_status: { args: undefined; result: QuietRunEvent | null }
  get_secret_statuses: { args: undefined; result: Record<string, SecretStatus> }
  get_secret_vault_state: { args: undefined; result: VaultState }
  get_storage_info: { args: undefined; result: StorageInfo }
  get_subtitles: { args: undefined; result: SubtitlesSnapshot }
  get_text_insertion_status: { args: undefined; result: TextInsertionStatus }
  hide_quick_window_on_blur: { args: { activationId: number }; result: void }
  hide_subtitles: { args: undefined; result: WindowGeometry | null }
  hide_window: { args: { activationId: number }; result: void }
  inspect_ai_project_transfer: {
    args: { id: string; targetPath?: string | null }
    result: ProjectTransferPreview
  }
  inspect_ai_vault_folder: { args: { path: string }; result: VaultFolder }
  inspect_user_data_target: {
    args: { path?: string | null }
    result: UserDataTarget
  }
  install_plugin_package: {
    args: { inspectionId: string }
    result: InstalledPlugin
  }
  list_ai_file_roots: {
    args: { context: ToolCallContext; attachments: Array<AiAttachedFile> }
    result: Array<AiFileRoot>
  }
  list_ai_profile_memory_topics: {
    args: { profileId: string }
    result: Array<ProfileMemoryTopic>
  }
  list_ai_profiles: { args: undefined; result: Array<AiProfile> }
  list_ai_projects: { args: undefined; result: Array<AiProject> }
  list_ai_vaults: { args: undefined; result: Array<VaultInfo> }
  list_chats: {
    args: { profileId?: string | null }
    result: Array<ChatSummary>
  }
  list_dialogs: { args: undefined; result: Array<DialogSummary> }
  list_input_devices: { args: undefined; result: Array<AudioInputDevice> }
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
  move_ai_profile: {
    args: { id: string; vaultId: string }
    result: MovedEntity
  }
  move_ai_project: {
    args: { id: string; vaultId: string }
    result: MovedEntity
  }
  open_action_log: { args: undefined; result: boolean }
  open_ai_project_location: { args: { id: string }; result: void }
  open_ai_vault_location: {
    args: { vaultId?: string | null; profileId?: string | null }
    result: void
  }
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
      newChat?: boolean | null
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
  open_recordings_folder: { args: { dialogId?: string | null }; result: void }
  open_socket: {
    args: { request: SocketRequest; onEvent: DesktopChannel }
    result: number
  }
  open_storage_location: { args: { kind: StorageKind }; result: void }
  open_system_hotkey_settings: { args: undefined; result: void }
  open_transferred_chat: {
    args: { transfer: ChatTransfer; activationId: number }
    result: void
  }
  paste_into_target_and_hide: {
    args: { activationId: number; text: string }
    result: void
  }
  patch_session_state: {
    args: { patch: SessionStatePatch }
    result: DesktopSnapshot
  }
  peek_ai_profile_memory: {
    args: { profileId: string; file: string }
    result: string
  }
  pick_directory: { args: undefined; result: string | null }
  pick_file: { args: undefined; result: string | null }
  pick_plugin_package: { args: undefined; result: PluginPackagePreview | null }
  pick_script_file: { args: undefined; result: string | null }
  preview_ai_file_change: {
    args: {
      context: ToolCallContext
      attachments: Array<AiAttachedFile>
      request: AiFileToolRequest
    }
    result: AiFileChangePreview
  }
  publish_subtitles: { args: { view: SubtitlesView }; result: void }
  read_ai_file_bytes: {
    args: {
      context: ToolCallContext
      attachments: Array<AiAttachedFile>
      path: string
    }
    result: ArrayBuffer
  }
  read_ai_profile_memory: {
    args: { profileId: string; chatId?: string | null; file: string }
    result: string
  }
  read_ai_profile_soul: { args: { id: string }; result: ProfileSoul }
  read_chat_file: {
    args: { id: string; profileId?: string | null }
    result: ArrayBuffer
  }
  read_chat_image: {
    args: { id: string; profileId?: string | null }
    result: ArrayBuffer
  }
  read_dialog_recording: {
    args: { dialogId: string; file: string }
    result: ArrayBuffer
  }
  read_dropped_file: { args: { path: string }; result: ArrayBuffer }
  rebind_hotkeys: { args: undefined; result: void }
  release_deleted_chat_images: { args: { id: string }; result: void }
  release_dialog_recordings: { args: { id: string }; result: void }
  relink_ai_vault: {
    args: { vaultId: string; path: string }
    result: VaultInfo
  }
  relocate_user_data: {
    args: { mode: UserDataRelocationMode; path?: string | null }
    result: void
  }
  remove_screenshot: {
    args: { activationId: number; imageId?: string | null }
    result: void
  }
  rename_ai_vault: { args: { vaultId: string; name: string }; result: void }
  rename_chat: {
    args: { id: string; title: string; profileId?: string | null }
    result: void
  }
  rename_dialog: { args: { id: string; title: string }; result: void }
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
  reposition_quick_window: { args: { activationId: number }; result: void }
  request_subtitles_action: { args: { action: SubtitlesAction }; result: void }
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
      context: ToolCallContext
      attachments: Array<AiAttachedFile>
      request: AiFileToolRequest
      preview?: AiFileChangePreview | null
    }
    result: AiFileToolOutput
  }
  run_ai_web_tool: {
    args: {
      context: ToolCallContext
      request: AiWebToolRequest
      runId?: string | null
    }
    result: AiWebToolOutput
  }
  save_ai_profile: {
    args: { profile: AiProfile; expectedRevision?: string | null }
    result: string
  }
  save_ai_profile_memory: {
    args: {
      profileId: string
      file: string
      content: string
      expectedContent?: string | null
    }
    result: void
  }
  save_ai_project: {
    args: { project: AiProject; expectedRevision?: string | null }
    result: string
  }
  save_chat: { args: { chat: Chat; profileId?: string | null }; result: void }
  save_chat_file_to_workspace: {
    args: { profileId: string; fileId: string; name: string }
    result: string
  }
  save_dialog: { args: { dialog: Dialog }; result: void }
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
  search_dialogs: { args: { query: string }; result: Array<string> }
  send_socket_binary: { args: BinaryArgs<SocketFrameMeta>; result: void }
  send_socket_text: { args: { id: number; text: string }; result: void }
  set_ai_vault_chat_history: {
    args: { vaultId: string; chatHistory: VaultChatHistory }
    result: void
  }
  set_capture_microphone_muted: {
    args: { sessionId?: number | null; isMuted: boolean }
    result: void
  }
  set_editor_history_item_failure: {
    args: { id: string; failure: EditorHistoryFailure }
    result: void
  }
  set_editor_history_item_result: {
    args: { id: string; result: string }
    result: void
  }
  set_operation_catalog: {
    args: { tools: Array<OperationCatalogEntry> }
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
  set_subtitles_input_region: {
    args: { region?: InputRegion | null }
    result: void
  }
  set_tray_menu_labels: {
    args: {
      showLabel: string
      quitLabel: string
      tooltipLabel?: string | null
      quietRunLabels?: QuietRunLabels | null
    }
    result: void
  }
  set_tray_recording: {
    args: { isRecording: boolean; tooltipLabel?: string | null }
    result: void
  }
  show_desktop_notification: {
    args: { summary: string; body: string }
    result: void
  }
  show_dialog_recording: {
    args: { dialogId: string; file: string }
    result: void
  }
  show_status_overlay: {
    args: { request?: StatusOverlayRequest | null }
    result: void
  }
  show_subtitles: { args: { geometry?: WindowGeometry | null }; result: void }
  start_command_run: {
    args: { commandId: string; text?: string | null }
    result: ExternalJob
  }
  start_fetch: {
    args: { request: FetchRequest; onEvent: DesktopChannel }
    result: number
  }
  start_voice_capture: {
    args: {
      onAudio: DesktopChannel
      source?: CaptureSource | null
      microphoneId?: string | null
      isRecorded?: boolean | null
      dialogId?: string | null
      isMicrophoneMuted?: boolean | null
    }
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
  supply_command_run_input: { args: { id: string; text: string }; result: void }
  suspend_hotkeys: { args: { suspended: boolean }; result: void }
  switch_capture_source: {
    args: { sessionId: number; source: CaptureSource }
    result: void
  }
  switch_quick_mode: {
    args: { activationId: number; mode: ActivationMode }
    result: void
  }
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
  unwatch_audio_apps: { args: { watchId: number }; result: void }
  visible_work_ended: { args: { id: number }; result: void }
  watch_audio_apps: { args: { onApps: DesktopChannel }; result: number }
  write_ai_profile_soul: {
    args: { id: string; content: string; expectedRevision?: string | null }
    result: string
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
  'open_transferred_chat',
  'paste_into_target_and_hide',
  'remove_screenshot',
  'reposition_quick_window',
  'reveal_quick_window',
  'set_quick_input_region',
  'switch_quick_mode',
] as const satisfies readonly DesktopCommandName[]
