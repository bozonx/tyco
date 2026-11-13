// Generated from src-tauri by scripts/generate-desktop-commands.mjs.
// Do not edit: run pnpm generate:desktop.
// Source hash: 0aed15df4a94f8427b0f4a752f983de97006d18bca852e053fb0e2ef189036ef
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

/**
 * Asks the open action menu of `activation_id` to turn to `page_index`, or to
 * advance to the next page when `page_index` repeats the last requested page.
 */
export type ActionPageTurnEvent = { activationId: number; pageIndex: number }

/** A moment of an activation the webview reports. */
export type ActivationMetricMark = 'frame' | 'dom-focus' | 'first-char'

/** Asks the quick window to start or collect the activation metrics `id`. */
export type ActivationMetricsRequest = { id: number }

export type ActivationMode =
  | 'editor'
  | 'quickInput'
  | 'chat'
  | 'voiceCommands'
  | 'voice'
  | 'listen'
  | 'selectionActions'
  | 'correction'
  | 'translation'
  | 'styling'
  | 'transformation'
  | 'quickAiRequest'
  | 'voiceQuickAiRequest'
  | 'screenshotQuickAiRequest'
  | 'voiceScreenshotQuickAiRequest'
  | 'chatPrompts'
  | 'favorites'
  | 'history'
  | 'config'
  | 'customAction'
  | 'externalAccess'

/** A file attached to the conversation, as the webview names it. */
export type AiAttachedFile = {
  /** The file name the model reaches it by, unique in the conversation. */
  name: string
  /** The id of the original in the conversation's file store. */
  id: string
}

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
  /**
   * Why the folder cannot be reached on this device: an external project
   * without its folder here.
   */
  unavailable?: string
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
      /** Characters to skip when continuing a partially read line. */
      nextCharacterOffset?: number
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
      /** Characters to skip in the first line, from 0 (Unicode scalar values). */
      characterOffset?: number | null
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
  /** The model the profile's chats run on; the first usable one when unset. */
  modelId?: string
  /**
   * The model last picked for quick AI requests in this profile; the quick
   * request model of the settings when unset.
   */
  quickRequestModelId?: string
  /** Overrides the temperature of the model; the model's own when unset. */
  temperature?: number
  /** Caps the answer length below the model's own limit. */
  maxOutputTokens?: number
  projectPermissions: { [key in string]: ProjectPermission }
  /** No tools when unset. */
  tools?: ProfileToolSettings
  /** Long-term memory mode; defaults to `auto`. */
  memoryMode: ProfileMemoryMode
  createdAt: number
  updatedAt: number
  /**
   * The SHA-256 of the file as it was read, for a save to check that no other
   * device or editor changed it since; never stored in the file.
   */
  revision?: string
}

export type AiProject = {
  id: string
  name: string
  description?: string
  isExternal: boolean
  targetPath?: string
  createdAt: number
  updatedAt: number
  /**
   * The SHA-256 of the file as it was read, for a save to check that no other
   * device or editor changed it since; never stored in the file.
   */
  revision?: string
  /**
   * The folder of an external project lies inside the data folder or a vault
   * and is synced with it; never stored in the file.
   */
  isInsideSyncedFolder?: boolean
}

export type AiWebToolOutput =
  | { operation: 'search'; results: Array<WebSearchResultItem> }
  | {
      operation: 'fetch'
      url: string
      title?: string
      /** The page from `offset`, at most `maxCharacters` long */
      content: string
      offset: number
      totalCharacters: number
    }

export type AiWebToolRequest =
  | {
      operation: 'search'
      query: string
      count?: number
      /**
       * Two-letter country code for regional results (Jina `gl`, e.g. `us`,
       * `ru`).
       */
      country?: string
      /** Language code for search results (Jina `hl`, e.g. `en`, `ru`). */
      language?: string
      /** City or region name for localized search (e.g. `Moscow, Russia`). */
      location?: string
      /** 1-based search results page number. */
      page?: number
      /**
       * Restrict search results to a single domain or URL prefix (Jina
       * `X-Site`).
       */
      site?: string
    }
  | {
      operation: 'fetch'
      url: string
      maxCharacters?: number
      /** The character the returned page starts at, to read on after a cut */
      offset?: number
      /**
       * Preferred browser locale for rendering the page (Jina `X-Locale`, e.g.
       * `en-US`).
       */
      locale?: string
    }

/** An application that plays sound right now. */
export type AudioApp = {
  id: string
  label: string
  iconName?: string
  /** The loudest of its streams, from 0 to 1. */
  level: number
}

/** What a watch sends through its channel. */
export type AudioAppsEvent = { type: 'apps'; apps: Array<AudioApp> }

/** An input device (microphone) available on this machine. */
export type AudioInputDevice = { id: string; label: string; isDefault: boolean }

/** Where the audio of a capture comes from. */
export type CaptureSource =
  | { kind: 'microphone' }
  | { kind: 'systemMix' }
  | { kind: 'application'; appId: string }

export type Chat = {
  id: string
  title: string
  /** Unix time in milliseconds. */
  lastMessageAt: number
  messages: Array<ChatMessage>
  isQuickRequest?: boolean
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
   * The original of an attached file, kept with the conversation; none for a
   * text that is not a file.
   */
  file?: ChatAttachmentFile
}

/** The original of an attached file in the conversation's file store. */
export type ChatAttachmentFile = {
  /** The SHA-256 of the bytes, which names the stored file. */
  id: string
  size: number
}

/**
 * Where an attached text came from: `selection` was selected in another
 * application, the others come from the editor of the app.
 */
export type ChatAttachmentSource =
  'selection' | 'editorSelection' | 'editorText'

export type ChatFileMeta = {
  /** Holds the file until a sync of the chat releases it. */
  importId: string
}

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
  isQuickRequest?: boolean
}

/**
 * A live conversation, with its images if any, transferred to the main chat
 * without a history round trip.
 */
export type ChatTransfer = {
  chat: Chat
  question: string | null
  /** The profile whose chat receives the conversation; none for Ask AI */
  profileId: string | null
}

/**
 * A chat history changed: every window reloads its list, and a window showing a
 * removed chat leaves it instead of writing it back.
 */
export type ChatsChangedEvent = {
  /** `None` for the chats of "Ask AI". */
  profileId?: string | null
  /** The chats that are gone. */
  removedChatIds: Array<string>
  /** Every chat of the history is gone. */
  isCleared: boolean
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

export type CropRect = { x: number; y: number; width: number; height: number }

export type DesktopActivationState = {
  activationId: number
  windowId: string | null
  selectedText: string | null
  /** Explicit text passed when opening quick input from another workflow. */
  quickInputText?: string
  screenshots?: Array<ChatImage>
  screenshot?: ChatImage
  mode: ActivationMode | null
  /**
   * The page of `actionPages` the menu opens on, for `selectionActions`; `None`
   * or 0 for the first one.
   */
  actionPageIndex: number | null
  /** The slot index for `customAction`; `None` or 0 for the first one. */
  customActionIndex: number | null
  /** The source the history opens filtered by, e.g. from the quick input. */
  historyOrigin: EditorHistoryOrigin | null
  /** The tab the settings open on, e.g. from a menu that has nothing to show. */
  settingsTab: string | null
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
  | 'userDataUnavailable'
  | 'variableNotSet'
  | 'vaultUnavailable'
  | 'projectUnavailable'
  | 'stale'
  | 'alreadyExists'
  | 'staleRevision'
  | 'runtimeError'
  | 'ioError'
  | 'invalidData'

/** How every failed command reaches the webview. */
export type DesktopErrorPayload = { code: DesktopErrorCode; message: string }

export type DesktopSettingsState = {
  userConfig: UserConfig
  sessionState: SessionState
  /** Where the user data folder is and whether it can be used. */
  userData: UserDataState
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
  /**
   * The quick window can be dragged: not on a layer-shell surface, whose place
   * only its anchor and margins set.
   */
  canMoveOverlay: boolean
  /** The sound the computer plays can be recorded, see `platform::audio`. */
  canListen: boolean
  /** A single application can be recorded. */
  canListenToApps: boolean
}

/** What the UI sends to add a text; id and time are assigned by the backend. */
export type EditorHistoryEntry = {
  /** Stable identity of a live input; only unfinished entries may be replaced. */
  id?: string | null
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation | null
  origin?: EditorHistoryOrigin | null
  instruction?: EditorHistoryInstruction | null
  profileId?: string | null
}

/** What went wrong with the AI transformation of a `Source` entry. */
export type EditorHistoryFailure = {
  kind: EditorHistoryFailureKind
  /** The error the user was shown, if any. */
  message?: string
}

/** Why an AI transformation of a `Source` entry produced no result. */
export type EditorHistoryFailureKind = 'error' | 'timeout' | 'cancelled'

/** The input modality of an AI prompt. */
export type EditorHistoryInputKind = 'typed' | 'voice'

/** The prompt or instruction for an AI transformation. */
export type EditorHistoryInstruction = {
  text: string
  inputKind: EditorHistoryInputKind
}

export type EditorHistoryItem = {
  id: string
  text: string
  kind: EditorHistoryKind
  operation?: EditorHistoryOperation
  /** Where the text came from; none for an entry without one. */
  origin?: EditorHistoryOrigin
  /** The prompt or instruction of a transformation. */
  instruction?: EditorHistoryInstruction
  /** Profile this operation ran under, if any. */
  profileId?: string
  /** Unix time in milliseconds. */
  createdAt: number
  /** What the AI turned a `Source` entry into. */
  result?: string
  /** The `result` of a `Source` entry was inserted into a window or copied. */
  isResultApplied?: boolean
  /** Why the AI produced no `result` for a `Source` entry. */
  failure?: EditorHistoryFailure
}

/** Why a text got into the editor history. */
export type EditorHistoryKind = 'output' | 'draft' | 'source'

/** The AI transformation a `Source` entry was taken before. */
export type EditorHistoryOperation =
  'aiTask' | 'translation' | 'correction' | 'voiceCorrection'

/**
 * Where the text came from: where the user typed or dictated it, or the quick
 * request whose answer was inserted or copied.
 */
export type EditorHistoryOrigin =
  'quickInput' | 'voice' | 'quickAiRequest' | 'listen'

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

export type FetchPurpose = 'chat-image' | 'webhook'

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
  /** The shell line that runs each hotkey id, as `tyco-ctl --help` spells it */
  commands: { [key in string]: string }
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

/** What presses the paste and copy keys in other windows. */
export type KeySender = 'ydotool' | 'portal' | 'system'

export type KeysState = 'ready' | 'needsPermission' | 'unavailable'

/** What the main window opens its chat with. */
export type OpenMainChatEvent = {
  attachment?: ChatAttachment | null
  question?: string | null
  autoSend: boolean
  profileId?: string
  chatId?: string
}

/** What a picked package would install, for the user to confirm. */
export type PluginPackagePreview = {
  /** What `install_plugin_package` takes to install this package. */
  inspectionId: string
  manifest: PluginManifest
}

/** The change applied to a profile memory file. */
export type ProfileMemoryChange = {
  file: string
  before?: string
  after: string
}

/** The memory mode of a profile. */
export type ProfileMemoryMode = 'auto' | 'ask' | 'read-only' | 'off'

/** A line matching a memory text search. */
export type ProfileMemorySearchResult = {
  file: string
  lineNumber: number
  text: string
}

/** Summary of a memory file or topic in a profile's memory. */
export type ProfileMemoryTopic = {
  file: string
  title: string
  description?: string
  bytes: number
  updatedAt: number
}

/** The root instruction of a profile with its revision, empty for no file. */
export type ProfileSoul = { content: string; revision: string }

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

export type ScreenshotAreaSelection = {
  /** Echoed by `confirm_screenshot_crop` / `cancel_screenshot_crop`. */
  selectionId: number
  imageId: string
  /** How the bytes of `image_id` are encoded */
  mediaType: ScreenshotPreviewMediaType
  screenX: number
  screenY: number
  width: number
  height: number
  scaleFactor: number
}

export type ScreenshotCaptureMode = 'screen' | 'area'

/** The encoding of the frozen image the area selector shows. */
export type ScreenshotPreviewMediaType = 'image/png'

/** A request of the webview to run a saved script. */
export type ScriptActionRequest = {
  /**
   * The saved command to run; its shell command, working directory and timeout
   * are read from the config, see `user_config::script_command`.
   */
  commandId: string
  text: string
  selectionText?: string | null
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
  | 'pasted'
  | 'clipboard'
  | 'selectionChanged'
  | 'terminal'
  | 'restored'
  | 'stale'

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
  /** The chat last opened in each profile, by profile id. */
  lastProfileChatIds: { [key in string]: string }
  /** Languages picked from the full list in the translate menu, newest first. */
  recentTranslateLanguages: Array<string>
}

export type SessionStatePatch = Partial<SessionState>

/**
 * The fields another device changed too, where the save of this one won; the
 * version of the other device is kept in the recovery folder.
 */
export type SettingsConflictEvent = { paths: Array<string> }

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

/** Files of the app that changed on disk, outside this window or in it. */
export type StorageChangedEvent = {
  /** Paths relative to the data folder, with `/`. */
  paths: Array<string>
  /** Files of the vaults, each with its vault. */
  vaultChanges: Array<VaultChange>
}

export type StorageInfo = {
  /** The system folders of the app; the user data folder is `user_data`. */
  locations: Array<StorageLocation>
  userData: UserDataState
}

/**
 * What a storage location holds: the user data folder (settings, history,
 * chats, plugins), the files of this device (device settings, key list), and
 * the system folders of the app.
 */
export type StorageKind = 'user' | 'device' | 'state' | 'cache' | 'logs'

/**
 * A directory the app keeps files in, with everything it holds: the platform
 * may put several kinds into one directory.
 */
export type StorageLocation = { kinds: Array<StorageKind>; path: string }

/** How Tyco finds the window to insert into. */
export type TargetTracking = 'tracked' | 'focusReturn'

/** Why keys cannot be pressed, for the settings to tell how to fix it. */
export type TextInsertionProblem =
  | 'unsupportedSession'
  | 'ydotoolMissing'
  | 'ydotoolOutdated'
  | 'ydotooldNotRunning'
  | 'portalUnavailable'
  | 'accessibilityDenied'

export type TextInsertionStatus = {
  /** What presses the keys; none when nothing can. */
  keySender?: KeySender
  keys: KeysState
  problem?: TextInsertionProblem
  /** What the system reported, in English. */
  detail?: string
  target: TargetTracking
  /**
   * Clipboard tools the session needs and lacks, e.g. `wl-copy`: without them
   * nothing can be inserted or captured.
   */
  missingClipboardTools: Array<string>
}

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
  /**
   * Commands selected for this group, when the group offers them (e.g.
   * `commands`).
   */
  commandIds?: Array<string>
}

/**
 * How `relocate_user_data` changes the user data folder; the user says it, the
 * backend never guesses it from what a folder holds.
 */
export type UserDataRelocationMode = 'move' | 'connect' | 'useDefault'

/**
 * Where the user data folder is and whether it can be used, and the device it
 * is used on; fixed for the life of the process, as changing the folder
 * restarts the app.
 */
export type UserDataState = {
  /**
   * Marker identity of the main vault; absent while the data folder is
   * unavailable.
   */
  mainVaultId?: string
  path: string
  /** The folder the data is in when the user has chosen none. */
  defaultPath: string
  isDefault: boolean
  status: UserDataStatus
  /**
   * Other users may write into the folder or its parent, and so change the
   * commands this app runs (checked on Linux only).
   */
  isWritableByOthers: boolean
  /** The id of this device, the built-in variable `TYCO_DEVICE_ID`. */
  deviceId: string
  /** The platform of this device: a command limited to others does not run. */
  platform: 'linux' | 'windows' | 'macos'
}

/** Whether the user data folder can be used. */
export type UserDataStatus = 'connected' | 'notConnected' | 'newerFormat'

export type UserDataTarget = {
  path: string
  /** The default folder of the platform. */
  isDefault: boolean
  contents: UserDataTargetKind
}

/** What a folder the user data may go to holds. */
export type UserDataTargetKind =
  | { kind: 'current' }
  | { kind: 'empty' }
  | { kind: 'userData'; formatVersion: number; isSupported: boolean }
  | { kind: 'unfinished' }
  | { kind: 'occupied'; subfolderPath: string }
  | { kind: 'forbidden' }

/** A file of a vault that changed. */
export type VaultChange = {
  /** The vault part of references: empty for the main vault. */
  vaultId: string
  /** Relative to the root of the vault, with `/`. */
  path: string
}

export type VaultFolder = { path: string; kind: VaultFolderKind }

/** What a folder offered for a vault holds. */
export type VaultFolderKind =
  | { kind: 'vault'; name: string }
  | { kind: 'empty' }
  | { kind: 'occupied'; subfolder: string }
  | { kind: 'duplicate' }
  | { kind: 'nested'; message: string }

/** A vault as the settings show it. */
export type VaultInfo = {
  /**
   * The vault part of the references of its profiles and projects; empty for
   * the main vault.
   */
  vaultId: string
  name: string
  path: string
  isMain: boolean
  status: VaultStatus
  /** Others may write to it: its profiles run the commands of this device. */
  isWritableByOthers: boolean
}

/** Whether the system credential store can be reached. */
export type VaultState = 'available' | 'unavailable'

/** Where an attached vault stands on this device. */
export type VaultStatus = 'connected' | 'notConnected' | 'newer'

export type VoiceAudioLevelPayload = { level: number; peak: number }

/** Control messages on the audio channel; the audio itself goes as raw bytes. */
export type VoiceCaptureEvent =
  | { type: 'end' }
  | { type: 'superseded' }
  | { type: 'error'; message: string }
  | { type: 'sourceStatus'; isWaiting: boolean }
  | { type: 'sourceLost'; source: CaptureSource }

export type VoiceCaptureInfo = {
  /** Rate of the PCM16 mono chunks that follow. */
  sampleRate: number
  /** What `stop_capture` takes to stop this capture and no other. */
  sessionId: number
}

export type WebSearchResultItem = {
  title: string
  url: string
  description: string
  content?: string
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
  'userDataUnavailable',
  'variableNotSet',
  'vaultUnavailable',
  'projectUnavailable',
  'stale',
  'alreadyExists',
  'staleRevision',
  'runtimeError',
  'ioError',
  'invalidData',
] as const satisfies readonly DesktopErrorCode[]

/** The payload of every event the backend sends to the webviews. */
export interface DesktopEventPayloads {
  'app://quit-requested': number
  'app://quit-cancelled': null
  'app://storage-changed': StorageChangedEvent
  'app://plugins-changed': null
  'app://state-changed': DesktopSnapshot
  'app://hotkeys-changed': null
  'app://open-transferred-chat': ChatTransfer
  'app://screenshot-failed': DesktopErrorCode
  'app://screenshot-select-area': ScreenshotAreaSelection
  'app://screenshot-select-area-closed': null
  'app://open-main-chat': OpenMainChatEvent
  'app://open-main-editor': EditorTransfer
  'app://chats-changed': ChatsChangedEvent
  'app://editor-history-changed': null
  'app://settings-conflict': SettingsConflictEvent
  'app://main-window-closed': null
  'app://activation-metrics-start': ActivationMetricsRequest
  'app://activation-metrics-collect': ActivationMetricsRequest
  'app://voice-finish': number
  'app://action-page-turn': ActionPageTurnEvent
  'app://voice-release': number
  'app://voice-audio-level': VoiceAudioLevelPayload
  'app://selection-run': SelectionRunEvent
  'app://selection-cancel': SelectionCancelEvent
  'app://command-run': CommandRunEvent
  'app://external-job-cancel': string
}
