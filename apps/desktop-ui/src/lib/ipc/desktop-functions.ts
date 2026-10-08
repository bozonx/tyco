import type {
  InstalledPluginPackage,
  PluginPackagePreview,
  ChatHistoryItem,
  CommandRunRecord,
  EditorHistoryEntry,
  EditorHistoryItem,
  HotkeyApplyResult,
  HotkeyProviderInfo,
  IpcResult,
  LocalState,
  SelectionFinishStatus,
  StatusOverlayRequest,
  StorageInfo,
  StorageKind,
  ToolCatalogEntry,
  UserConfig,
  ScriptActionRequest,
  ScriptExecutionResult,
} from '@tyco/shared'

import type { InputRect } from '../quick-panel/input-region'

/**
 * What every desktop function takes and returns. The Rust commands behind them
 * are listed in `createCommandMap`, so a wrong name or argument is a type error
 * instead of a failure at run time
 */
export interface DesktopFunctions {
  inspectPluginPackage: { args: []; result: PluginPackagePreview | null }
  listInstalledPlugins: { args: []; result: InstalledPluginPackage[] }
  installPluginPackage: {
    args: [preview: PluginPackagePreview]
    result: InstalledPluginPackage
  }
  restorePluginPackage: { args: [id: string]; result: void }
  removePluginPackage: { args: [id: string]; result: void }
  saveUserConfig: { args: [userConfig: UserConfig]; result: void }
  patchLocalState: { args: [patch: Partial<LocalState>]; result: LocalState }
  getStorageInfo: { args: []; result: StorageInfo }
  /** Shows the directory of a kind in the file manager */
  openStorageLocation: { args: [kind: StorageKind]; result: void }
  closeWindow: { args: []; result: void }
  dismissQuickWindow: { args: []; result: void }
  setQuickInputRegion: { args: [region: InputRect | null]; result: void }
  openMainChat: { args: [text?: string]; result: void }
  openMainEditor: { args: [text?: string, sourceText?: string]; result: void }
  activateMode: { args: [mode: string, text?: string]; result: void }
  applyHotkey: {
    args: [request: { mode: string; shortcut: string }]
    result: HotkeyApplyResult
  }
  configureHotkeys: { args: []; result: void }
  rebindHotkeys: { args: []; result: void }
  suspendHotkeys: { args: [suspended: boolean]; result: void }
  getHotkeyProviderInfo: { args: []; result: HotkeyProviderInfo }
  markActivationMetric: { args: [id: number, mark: string]; result: void }
  submitActivationMetricValue: {
    args: [id: number, value: string]
    result: void
  }
  getEditorHistory: { args: []; result: EditorHistoryItem[] }
  getChatHistory: { args: []; result: ChatHistoryItem[] }
  getChat: { args: [id: string]; result: ChatHistoryItem | null }
  saveEditorHistory: {
    args: [entry: EditorHistoryEntry]
    result: string | null
  }
  setEditorHistoryResult: { args: [id: string, result: string]; result: void }
  restoreEditorHistoryItem: { args: [item: EditorHistoryItem]; result: void }
  saveChatHistory: { args: [chatHistoryItem: ChatHistoryItem]; result: void }
  renameChat: { args: [id: string, description: string]; result: void }
  searchChatHistory: { args: [query: string]; result: string[] }
  removeFromEditorHistory: { args: [id: string]; result: void }
  removeFromChatHistory: { args: [id: string]; result: void }
  clearEditorHistory: { args: []; result: void }
  clearChatHistory: { args: []; result: void }
  typeIntoWindowAndClose: { args: [text: string]; result: void }
  putIntoClipboardAndClose: { args: [text: string]; result: void }
  openInBrowserAndClose: { args: [url: string]; result: void }
  finishSelectionRun: {
    args: [runId: number, text: string | null]
    result: SelectionFinishStatus
  }
  showStatusOverlay: {
    args: [request: StatusOverlayRequest | null]
    result: void
  }
  notifyDesktop: { args: [summary: string, body: string]; result: void }
  checkTextInjection: { args: []; result: void }
  saveNote: {
    args: [dir: string, fileName: string, text: string]
    result: string
  }
  appendNote: {
    args: [dir: string, fileName: string, text: string]
    result: string
  }
  executeScriptAction: {
    args: [request: ScriptActionRequest]
    result: ScriptExecutionResult
  }
  cancelScriptAction: { args: [runId: string]; result: boolean }
  pickScriptFile: { args: []; result: string | null }
  pickDirectory: { args: []; result: string | null }
  logCustomAction: {
    args: [name: string, actionType: string, details: string]
    result: void
  }
  logCommandRun: { args: [record: CommandRunRecord]; result: void }
  logClientMessage: {
    args: [level: string, message: string, context?: string]
    result: void
  }
  setToolCatalog: { args: [tools: ToolCatalogEntry[]]; result: void }
  copyText: { args: [text: string]; result: void }
  getUserConfig: { args: []; result: UserConfig }
  replaceSelectionWithCommand: { args: [commandId: string]; result: void }
}

export type DesktopFunctionName = keyof DesktopFunctions

export type DesktopFunctionArgs<K extends DesktopFunctionName> =
  DesktopFunctions[K]['args']

export type DesktopFunctionResult<K extends DesktopFunctionName> =
  DesktopFunctions[K]['result']

/** The arguments may be left out when a function takes none */
export type DesktopCallArgs<K extends DesktopFunctionName> =
  DesktopFunctionArgs<K> extends []
    ? [args?: []]
    : [args: DesktopFunctionArgs<K>]

export type DesktopCall = <K extends DesktopFunctionName>(
  name: K,
  ...args: DesktopCallArgs<K>
) => Promise<IpcResult<DesktopFunctionResult<K>>>

/** What plugins may call: they get no access to the rest of the backend */
export const PLUGIN_DESKTOP_FUNCTIONS = [
  'openInBrowserAndClose',
  'saveNote',
  'appendNote',
] as const satisfies readonly DesktopFunctionName[]

export type PluginDesktopFunctionName =
  (typeof PLUGIN_DESKTOP_FUNCTIONS)[number]
