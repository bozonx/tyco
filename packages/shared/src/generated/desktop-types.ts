// Generated from src-tauri by scripts/generate-desktop-commands.mjs.
// Do not edit: run pnpm generate:desktop.
// Source hash: 9c6bcd214c06573619b8b54000af3fa9f6ce9249262af4f26140ae1af3eec837
import type { PluginManifest } from '@tyco/plugin-sdk'
import type { ChatMessagePart } from '../desktop/chat'
import type { UserConfig } from '../user-config'

export type AccessDecision = 'once' | 'always' | 'deny'

/** What the prompt shows, see `DesktopSnapshot::access_request`. */
export type AccessRequest = {
  jobId: string
  commandName: string
  /** The output is to replace the selection, not only to be returned. */
  replace: boolean
}

/** A moment of an activation the webview reports. */
export type ActivationMetricMark = 'frame' | 'dom-focus' | 'first-char'

/** Asks the quick window to start or collect the activation metrics `id`. */
export type ActivationMetricsRequest = { id: number }

export type ActivationMode =
  | 'editor'
  | 'quickInput'
  | 'chat'
  | 'voiceChat'
  | 'voiceCommands'
  | 'voice'
  | 'selectionActions'
  | 'aiTasks'
  | 'commandLauncher'
  | 'correction'
  | 'translation'
  | 'history'
  | 'config'
  | 'externalAccess'

/** A change the user is asked about, before it is made. */
export type AiFileChangePreview = {
  path: string
  /** None for a file the change creates. */
  before: string | null
  after: string
}

export type AiFileEntry = {
  /** A folder's path ends with `/`. */
  path: string
  kind: AiFileEntryKind
  size?: number
}

export type AiFileEntryKind = 'file' | 'dir'

/** A folder the model may reach, as the profile sees it. */
export type AiFileRoot = {
  /** What the model calls it: `workspace` or `projects/<id>`. */
  path: string
  /** The project's name; none for the workspace. */
  name?: string
  description?: string
  read: ProjectAccessMode
  write: ProjectAccessMode
}

export type AiFileSearchMatch = {
  path: string
  /** None when the file matched by its name. */
  line?: number
  text?: string
}

/** What a file tool did, for the webview to tell the model. */
export type AiFileToolOutput =
  | {
      operation: 'listDir'
      path: string
      entries: Array<AiFileEntry>
      isTruncated: boolean
    }
  | {
      operation: 'readFile'
      path: string
      content: string
      startLine: number
      endLine: number
      totalLines: number
      /** The offset to read on from; none at the end of the file. */
      nextOffset?: number
    }
  | { operation: 'readDocument'; path: string; mediaType: string }
  | {
      operation: 'searchFiles'
      matches: Array<AiFileSearchMatch>
      isTruncated: boolean
    }
  | { operation: 'writeFile'; path: string; isCreated: boolean; bytes: number }
  | { operation: 'editFile'; path: string; replacementCount: number }
  | { operation: 'movePath'; from: string; to: string }
  | { operation: 'deletePath'; path: string }

/** One call of a file tool, as the webview sends it. */
export type AiFileToolRequest =
  | {
      operation: 'listDir'
      /** Empty lists the roots. */
      path?: string
      depth?: number | null
      /** A glob on file names, e.g. `*.md`. */
      pattern?: string | null
    }
  | {
      operation: 'readFile'
      path: string
      /** The first line to read, from 1. */
      offset?: number | null
      /** How many lines to read. */
      limit?: number | null
      /** Whole lines are read up to this many characters. */
      maxCharacters?: number | null
    }
  | {
      operation: 'searchFiles'
      /** Empty searches every root the profile may read. */
      path?: string
      /** Text the lines must contain. */
      query?: string | null
      /** A glob the file names must match. */
      namePattern?: string | null
      isRegex?: boolean
    }
  | { operation: 'writeFile'; path: string; content: string }
  | {
      operation: 'editFile'
      path: string
      oldText: string
      newText: string
      replaceAll?: boolean
    }
  | { operation: 'movePath'; from: string; to: string }
  | { operation: 'deletePath'; path: string }

/** A profile; its root instruction lives next to it in `SOUL.md`. */
export type AiProfile = {
  id: string
  name: string
  /** An `mdi:*` icon from the app's own set; the default one when unset. */
  icon?: string
  /**
   * The model the profile's chats run on; the first usable one when unset.
   * Profiles written before the setting kept the last picked model.
   */
  modelId?: string
  /** Overrides the temperature of the model; the model's own when unset. */
  temperature?: number
  /** Caps the answer length below the model's own limit. */
  maxOutputTokens?: number
  projectPermissions: { [key in string]: ProjectPermission }
  /** No tools when unset. */
  tools?: ProfileToolSettings
  createdAt: number
  updatedAt: number
}

export type AiProject = {
  id: string
  name: string
  description?: string
  isExternal: boolean
  targetPath?: string
  createdAt: number
  updatedAt: number
}

export type AiUploadMeta = {
  profileId: string
  /** The name of the dropped file. */
  name: string
}

export type Chat = {
  id: string
  title: string
  /** Unix time in milliseconds. */
  lastMessageAt: number
  messages: Array<ChatMessage>
}

/** A text the user attached to a chat message. */
export type ChatAttachment = {
  text: string
  /**
   * Where the attached text came from; unknown for attachments stored before it
   * was kept.
   */
  source?: ChatAttachmentSource
  name?: string
  mediaType?: string
  /**
   * Where a file dropped into a profile chat is kept for the file tools, e.g.
   * `workspace/uploads/report.pdf`.
   */
  workspacePath?: string
}

/**
 * Where an attached text came from: `selection` was selected in another
 * application, the others come from the editor of the app.
 */
export type ChatAttachmentSource =
  'selection' | 'editorSelection' | 'editorText'

/** A normalized image owned by the chat image store. */
export type ChatImage = {
  id: string
  mediaType: ChatImageMediaType
  width: number
  height: number
  size: number
  name?: string
}

export type ChatImageMediaType = 'image/webp'

export type ChatImageMeta = {
  /** Holds the image until a sync of the chat releases it. */
  importId: string
  name?: string | null
}

export type ChatMessage = {
  role: ChatRole
  content: string
  attachments?: Array<ChatAttachment>
  images?: Array<ChatImage>
  /** The steps of an answer that used tools; chats saved before them have none. */
  parts?: Array<ChatMessagePart>
  status?: ChatMessageStatus
}

export type ChatMessageStatus = 'complete' | 'stopped'

export type ChatRole = 'user' | 'assistant' | 'developer'

export type ChatSummary = {
  id: string
  title: string
  /** Unix time in milliseconds. */
  lastMessageAt: number
}

export type ClientLogLevel = 'error' | 'warn' | 'info' | 'debug'

/** Effective input for one configured command, computed by its tool registry. */
export type CommandInputDescription = {
  toolConfig: Record<string, unknown>
  input: ToolCatalogInput
  inputSchema: Record<string, unknown>
}

export type CommandRunEvent = {
  commandId: string
  jobId: string
  text?: string
  input?: Record<string, unknown>
  /** The quick window does not receive config changes made elsewhere. */
  userConfig: UserConfig
}

/** One run of a library command, as the command overlay reports it. */
export type CommandRunRecord = {
  commandId: string
  name: string
  source: CommandRunSource
  /** The text the command got; absent for a command that takes none. */
  text?: string | null
  success: boolean
  /** Why it failed, or what it reported. */
  message?: string | null
}

/** Where a command or a tool is invoked from. */
export type CommandRunSource =
  'menu' | 'toolbar' | 'launcher' | 'voice' | 'external' | 'chat' | 'selection'

export type DesktopActivationState = {
  activationId: number
  windowId: string | null
  selectedText: string | null
  mode: ActivationMode | null
  /**
   * The page of `launcherPages` the command overlay opens on; `None` for the
   * first one.
   */
  launcherPageId: string | null
  launcherRequest: LauncherRequest | null
  accessRequest: AccessRequest | null
}

/**
 * What went wrong with a desktop command, for the webview to decide on; the
 * message is for people.
 */
export type DesktopErrorCode =
  | 'operationFailed'
  | 'configConflict'
  | 'serviceUnavailable'
  | 'busy'
  | 'permissionDenied'
  | 'resourceLimit'
  | 'invalidInput'
  | 'notFound'
  | 'fileTooLarge'
  | 'unsupportedConfig'
  | 'stale'
  | 'runtimeError'
  | 'ioError'
  | 'invalidData'

/** How every failed command reaches the webview. */
export type DesktopErrorPayload = { code: DesktopErrorCode; message: string }

export type DesktopSettingsState = {
  userConfig: UserConfig
  sessionState: SessionState
}

/** Wire state is grouped by domain; all domains share a coherent revision. */
export type DesktopSnapshot = {
  revision: number
  activation: DesktopActivationState
  window: DesktopWindowState
  settings: DesktopSettingsState
}

export type DesktopWindowState = {
  isWindowShown: boolean
  windowProfile: WindowProfile
}

/** What the UI sends to add a text; id and time are assigned by the backend. */
export type EditorHistoryEntry = {
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation | null
  /** A draft entry this one supersedes: the same editing session saved again. */
  replaceId?: string | null
}

export type EditorHistoryItem = {
  id: string
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation
  /** Unix time in milliseconds. */
  createdAt: number
  /** What the AI turned a `Source` entry into. */
  result?: string
  /** The `result` of a `Source` entry was inserted into a window or copied. */
  isResultApplied?: boolean
}

/** Why a text got into the editor history. */
export type EditorHistoryKind = 'output' | 'draft' | 'source'

/** The AI transformation a `Source` entry was taken before. */
export type EditorHistoryOperation =
  'aiTask' | 'translation' | 'correction' | 'voiceCorrection'

/** A text handed over to the editor of the main window. */
export type EditorTransfer = {
  text?: string | null
  /** The text before an AI transformation, for the editor history. */
  sourceText?: string | null
}

export type ExternalJob = {
  id: string
  commandId: string
  state: ExternalJobState
  output?: string
  error?: string
  code?: string
}

export type ExternalJobState =
  'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Control events. Body chunks travel as raw bytes between `Head` and `End`. */
export type FetchEvent =
  | {
      type: 'head'
      status: number
      statusText: string
      headers: Array<[string, string]>
    }
  | { type: 'end' }
  | { type: 'error'; message: string }

export type FetchPurpose = 'chat-image'

export type FetchRequest = {
  method: string
  url: string
  headers?: Array<[string, string]>
  /** Base64: the IPC arguments are JSON, and the body may be audio. */
  body?: string | null
  /** A request of the app itself rather than of an AI provider. */
  purpose?: FetchPurpose | null
}

export type HotkeyApplyRequest = {
  /** The hotkey id, e.g. a mode or `selectionCorrection`. */
  mode: string
  shortcut: string
}

export type HotkeyApplyResult = {
  status: HotkeyApplyStatus
  externalCommand?: string
  message?: string
}

export type HotkeyApplyStatus = 'ready' | 'conflict' | 'external'

export type HotkeyProviderInfo = {
  provider: HotkeyProviderKind
  canConfigure: boolean
  /** Only external bindings report something per action: their command. */
  actions: { [key in string]: HotkeyApplyResult }
  /** The shortcuts the desktop bound through the portal, in its own words. */
  systemTriggers: { [key in string]: string }
  /**
   * The portal session is bound, so `system_triggers` is what the desktop has,
   * not what it has not reported yet
   */
  registered: boolean
  /** The default shortcut of every hotkey id on this platform */
  defaults: { [key in string]: string }
  platform: 'linux' | 'windows' | 'macos'
}

/**
 * What binds the hotkeys: the desktop portal, the global shortcut API of the
 * system, or the user in the desktop settings with `tyco-ctl`.
 */
export type HotkeyProviderKind = 'portal' | 'global-shortcut' | 'external'

/**
 * Part of the window, in logical pixels from its top left corner, that takes
 * pointer input.
 */
export type InputRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type InstalledPlugin = {
  manifest: PluginManifest
  /** Where `plugin://` serves the module from. */
  modulePath: string
  /** The version the last installation replaced can be restored. */
  hasPreviousVersion: boolean
}

export type JobCompletion = {
  success: boolean
  cancelled?: boolean
  output?: string | null
  message?: string | null
  code?: string | null
}

/** A command the overlay opens with, see `Activation::launcher_request`. */
export type LauncherRequest = {
  commandId: string
  /** The text of the call; without it the selection or the field gives it. */
  text?: string
  jobId?: string
  input?: Record<string, unknown>
}

/** What the main window opens its chat with. */
export type OpenMainChatEvent = {
  attachment?: ChatAttachment | null
  question?: string | null
  autoSend: boolean
}

/** What a picked package would install, for the user to confirm. */
export type PluginPackagePreview = {
  /** What `install_plugin_package` takes to install this package. */
  inspectionId: string
  manifest: PluginManifest
}

/** The tools a profile's chat may use. */
export type ProfileToolSettings = {
  /** By tool group id; a group that is not listed is off. */
  groups: { [key in string]: ToolGroupSettings }
  /**
   * Model steps per turn; `DEFAULT_TOOL_STEP_COUNT` of `@tyco/shared` when
   * unset.
   */
  maxStepCount?: number
}

export type ProjectAccessMode = 'allow' | 'ask' | 'deny'

export type ProjectPermission = {
  read: ProjectAccessMode
  write: ProjectAccessMode
}

export type ScriptActionRequest = {
  /**
   * The saved command to run; its shell command, working directory and timeout
   * are read from the config, see `user_config::script_command`.
   */
  commandId: string
  text: string
  captureOutput: boolean
  logOutput: boolean
  /** Lets `cancel_script_action` stop the command. */
  runId?: string | null
}

export type ScriptExecutionResult = {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  /** The command did not finish while waited for and keeps running. */
  running: boolean
}

/**
 * What the webview may know about a secret: that it exists, where it goes, and
 * whether its value can be read now.
 */
export type SecretStatus = {
  origins: Array<string>
  /** False while the vault holding the value is locked or unreachable. */
  available: boolean
}

export type SelectionCancelEvent = { runId: number }

export type SelectionFinishStatus =
  'pasted' | 'clipboard' | 'restored' | 'stale'

export type SelectionRunError = { code: SelectionRunErrorCode; message: string }

export type SelectionRunErrorCode =
  'noTarget' | 'noSelection' | 'capture' | 'unsupported'

/** Sent to the webview: the text to transform, or why there is none. */
export type SelectionRunEvent = {
  runId: number
  action: string
  text?: string
  error?: SelectionRunError
  /** The quick window does not receive config changes made elsewhere. */
  userConfig: UserConfig
}

export type SessionState = {
  lastChatId: string | null
  lastMode: ActivationMode | null
  /** The model the chat was last used with. */
  lastChatModelId: string | null
  /** The chat last opened in each profile, by profile id. */
  lastProfileChatIds: { [key in string]: string }
  /** Own AI requests typed in the AI task menu, the newest first. */
  recentAiPrompts: Array<string>
  /** Languages picked from the full list in the translate menu, newest first. */
  recentTranslateLanguages: Array<string>
}

export type SessionStatePatch = Partial<SessionState>

/** Control events. Binary frames travel as raw bytes. */
export type SocketEvent =
  | { type: 'open' }
  | { type: 'message'; data: string }
  | { type: 'close'; code: number; reason: string }
  | { type: 'error'; message: string }

export type SocketFrameMeta = {
  /** The socket the frame is for. */
  id: number
}

export type SocketRequest = {
  url: string
  headers?: Array<[string, string]>
  protocols?: Array<string>
}

export type StatusOverlayKind = 'pending' | 'success' | 'info' | 'error'

export type StatusOverlayRequest = {
  kind: StatusOverlayKind
  text: string
  /**
   * Shows a hidden bubble only after this delay, so quick work finishes without
   * anything flashing on the screen.
   */
  delayMs?: number
  hideAfterMs?: number | null
  /**
   * Updates a visible bubble, but neither shows a hidden one nor lets a pending
   * delay run out.
   */
  onlyIfVisible?: boolean
}

export type StorageInfo = { locations: Array<StorageLocation> }

/** What a storage location holds; history and chats are data. */
export type StorageKind = 'config' | 'data' | 'cache' | 'logs'

/**
 * A directory the app keeps files in, with everything it holds: the platform
 * may put several kinds into one directory.
 */
export type StorageLocation = { kinds: Array<StorageKind>; path: string }

/** A tool as the webview registry describes it, see `set_tool_catalog`. */
export type ToolCatalogEntry = {
  id: string
  input: ToolCatalogInput
  available: boolean
  /** Why it is not available, already translated. */
  reason?: string | null
  inputSchema?: Record<string, unknown>
  commandInputs: { [key in string]: CommandInputDescription }
}

/** How a command of a tool gets its input from a text. */
export type ToolCatalogInput = 'none' | 'text' | 'parsed' | 'structured'

/** Whether a group of tools is offered to the model, and how freely. */
export type ToolGroupSettings = {
  isEnabled: boolean
  /** `ask` waits for the user before each call; with no UI it means `deny`. */
  access: ProjectAccessMode
}

/** Whether the system credential store can be reached. */
export type VaultState = 'available' | 'unavailable'

export type VoiceAudioLevelPayload = { level: number; peak: number }

/** Control messages on the audio channel; the audio itself goes as raw bytes. */
export type VoiceCaptureEvent =
  { type: 'end' } | { type: 'error'; message: string }

export type VoiceCaptureInfo = {
  /** Rate of the PCM16 mono chunks that follow. */
  sampleRate: number
  /** What `stop_capture` takes to stop this capture and no other. */
  sessionId: number
}

/**
 * Where the window is placed. Its size never depends on it: every activation
 * uses `WINDOW_SIZE`, so the window is never resized while it is shown.
 */
export type WindowProfile = 'panel' | 'sheet'

/** Every code a failed desktop command reports. */
export const DESKTOP_ERROR_CODES = [
  'operationFailed',
  'configConflict',
  'serviceUnavailable',
  'busy',
  'permissionDenied',
  'resourceLimit',
  'invalidInput',
  'notFound',
  'fileTooLarge',
  'unsupportedConfig',
  'stale',
  'runtimeError',
  'ioError',
  'invalidData',
] as const satisfies readonly DesktopErrorCode[]

/** The payload of every event the backend sends to the webviews. */
export interface DesktopEventPayloads {
  'app://quit-requested': number
  'app://quit-cancelled': null
  'app://plugins-changed': null
  'app://state-changed': DesktopSnapshot
  'app://hotkeys-changed': null
  'app://open-main-chat': OpenMainChatEvent
  'app://open-main-editor': EditorTransfer
  'app://main-window-closed': null
  'app://activation-metrics-start': ActivationMetricsRequest
  'app://activation-metrics-collect': ActivationMetricsRequest
  'app://voice-finish': number
  'app://voice-audio-level': VoiceAudioLevelPayload
  'app://selection-run': SelectionRunEvent
  'app://selection-cancel': SelectionCancelEvent
  'app://command-run': CommandRunEvent
  'app://external-job-cancel': string
}
