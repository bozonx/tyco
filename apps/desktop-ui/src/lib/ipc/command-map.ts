import { DESKTOP_COMMANDS, type DesktopCommandName } from '@tyco/shared'
import type { DesktopFunctionName, DesktopFunctions } from './desktop-functions'

export type CommandEntry<Args extends unknown[]> = {
  command: DesktopCommandName
  buildArgs?: (args: Args) => Record<string, unknown>
  /** The command presses keys in another window, see `held-keys`. */
  waitForKeysReleased?: boolean
}

type CommandMap = {
  [K in DesktopFunctionName]: CommandEntry<DesktopFunctions[K]['args']>
}

export function createCommandMap(): CommandMap {
  return {
    inspectPluginPackage: { command: DESKTOP_COMMANDS.INSPECT_PLUGIN_PACKAGE },
    listInstalledPlugins: { command: DESKTOP_COMMANDS.LIST_INSTALLED_PLUGINS },
    installPluginPackage: {
      command: DESKTOP_COMMANDS.INSTALL_PLUGIN_PACKAGE,
      buildArgs: ([preview]) => ({
        path: preview.path,
        manifest: preview.manifest,
        digest: preview.digest,
      }),
    },
    restorePluginPackage: {
      command: DESKTOP_COMMANDS.RESTORE_PLUGIN_PACKAGE,
      buildArgs: ([id]) => ({ id }),
    },
    removePluginPackage: {
      command: DESKTOP_COMMANDS.REMOVE_PLUGIN_PACKAGE,
      buildArgs: ([id]) => ({ id }),
    },
    saveUserConfig: {
      command: DESKTOP_COMMANDS.SAVE_USER_CONFIG,
      buildArgs: ([userConfig, baseConfig]) => ({ userConfig, baseConfig }),
    },
    patchLocalState: {
      command: DESKTOP_COMMANDS.PATCH_LOCAL_STATE,
      buildArgs: ([patch]) => ({ patch }),
    },
    getStorageInfo: { command: DESKTOP_COMMANDS.GET_STORAGE_INFO },
    openStorageLocation: {
      command: DESKTOP_COMMANDS.OPEN_STORAGE_LOCATION,
      buildArgs: ([kind]) => ({ kind }),
    },
    closeWindow: { command: DESKTOP_COMMANDS.CLOSE_WINDOW },
    dismissQuickWindow: { command: DESKTOP_COMMANDS.DISMISS_QUICK_WINDOW },
    setQuickInputRegion: {
      command: DESKTOP_COMMANDS.SET_QUICK_INPUT_REGION,
      buildArgs: ([region]) => ({ region }),
    },
    openMainChat: {
      command: DESKTOP_COMMANDS.OPEN_MAIN_CHAT,
      buildArgs: ([attachment, question, autoSend]) => ({
        attachment,
        question,
        autoSend,
      }),
    },
    openMainEditor: {
      command: DESKTOP_COMMANDS.OPEN_MAIN_EDITOR,
      buildArgs: ([text, sourceText]) => ({ text, sourceText }),
    },
    activateMode: {
      command: DESKTOP_COMMANDS.ACTIVATE_MODE,
      buildArgs: ([mode, text]) => ({ mode, text }),
    },
    applyHotkey: {
      command: DESKTOP_COMMANDS.APPLY_HOTKEY,
      buildArgs: ([request]) => ({ request }),
    },
    configureHotkeys: { command: DESKTOP_COMMANDS.CONFIGURE_HOTKEYS },
    rebindHotkeys: { command: DESKTOP_COMMANDS.REBIND_HOTKEYS },
    suspendHotkeys: {
      command: DESKTOP_COMMANDS.SUSPEND_HOTKEYS,
      buildArgs: ([suspended]) => ({ suspended }),
    },
    getHotkeyProviderInfo: {
      command: DESKTOP_COMMANDS.GET_HOTKEY_PROVIDER_INFO,
    },
    markActivationMetric: {
      command: DESKTOP_COMMANDS.MARK_ACTIVATION_METRIC,
      buildArgs: ([id, mark]) => ({ id, mark }),
    },
    submitActivationMetricValue: {
      command: DESKTOP_COMMANDS.SUBMIT_ACTIVATION_METRIC_VALUE,
      buildArgs: ([id, value]) => ({ id, value }),
    },
    getEditorHistory: { command: DESKTOP_COMMANDS.GET_EDITOR_HISTORY },
    getChatHistory: { command: DESKTOP_COMMANDS.GET_CHAT_HISTORY },
    getChat: {
      command: DESKTOP_COMMANDS.GET_CHAT,
      buildArgs: ([id]) => ({ id }),
    },
    saveEditorHistory: {
      command: DESKTOP_COMMANDS.SAVE_EDITOR_HISTORY,
      buildArgs: ([entry]) => ({ entry }),
    },
    setEditorHistoryResult: {
      command: DESKTOP_COMMANDS.SET_EDITOR_HISTORY_RESULT,
      buildArgs: ([id, result]) => ({ id, result }),
    },
    restoreEditorHistoryItem: {
      command: DESKTOP_COMMANDS.RESTORE_EDITOR_HISTORY_ITEM,
      buildArgs: ([item]) => ({ item }),
    },
    saveChatHistory: {
      command: DESKTOP_COMMANDS.SAVE_CHAT_HISTORY,
      buildArgs: ([chatHistoryItem]) => ({ chatHistoryItem }),
    },
    renameChat: {
      command: DESKTOP_COMMANDS.RENAME_CHAT,
      buildArgs: ([id, description]) => ({ id, description }),
    },
    searchChatHistory: {
      command: DESKTOP_COMMANDS.SEARCH_CHAT_HISTORY,
      buildArgs: ([query]) => ({ query }),
    },
    removeFromEditorHistory: {
      command: DESKTOP_COMMANDS.REMOVE_FROM_EDITOR_HISTORY,
      buildArgs: ([id]) => ({ id }),
    },
    removeFromChatHistory: {
      command: DESKTOP_COMMANDS.REMOVE_FROM_CHAT_HISTORY,
      buildArgs: ([id]) => ({ id }),
    },
    clearEditorHistory: { command: DESKTOP_COMMANDS.CLEAR_EDITOR_HISTORY },
    clearChatHistory: { command: DESKTOP_COMMANDS.CLEAR_CHAT_HISTORY },
    typeIntoWindowAndClose: {
      command: DESKTOP_COMMANDS.TYPE_INTO_WINDOW_AND_CLOSE,
      buildArgs: ([text]) => ({ text }),
      waitForKeysReleased: true,
    },
    openInBrowser: {
      command: DESKTOP_COMMANDS.OPEN_IN_BROWSER,
      buildArgs: ([url]) => ({ url: String(url) }),
    },
    openInBrowserAndClose: {
      command: DESKTOP_COMMANDS.OPEN_IN_BROWSER_AND_CLOSE,
      buildArgs: ([url]) => ({ url: String(url) }),
    },
    finishSelectionRun: {
      command: DESKTOP_COMMANDS.FINISH_SELECTION_RUN,
      buildArgs: ([runId, text]) => ({ runId, text }),
    },
    showStatusOverlay: {
      command: DESKTOP_COMMANDS.SHOW_STATUS_OVERLAY,
      buildArgs: ([request]) => ({ request }),
    },
    notifyDesktop: {
      command: DESKTOP_COMMANDS.NOTIFY_DESKTOP,
      buildArgs: ([summary, body]) => ({ summary, body }),
    },
    checkTextInjection: { command: DESKTOP_COMMANDS.CHECK_TEXT_INJECTION },
    saveNote: {
      command: DESKTOP_COMMANDS.SAVE_NOTE,
      buildArgs: ([dir, fileName, text]) => ({ dir, fileName, text }),
    },
    appendNote: {
      command: DESKTOP_COMMANDS.APPEND_NOTE,
      buildArgs: ([dir, fileName, text]) => ({ dir, fileName, text }),
    },
    executeScriptAction: {
      command: DESKTOP_COMMANDS.EXECUTE_SCRIPT_ACTION,
      buildArgs: ([request]) => ({ request }),
    },
    cancelScriptAction: {
      command: DESKTOP_COMMANDS.CANCEL_SCRIPT_ACTION,
      buildArgs: ([runId]) => ({ runId }),
    },
    pickScriptFile: { command: DESKTOP_COMMANDS.PICK_SCRIPT_FILE },
    pickDirectory: { command: DESKTOP_COMMANDS.PICK_DIRECTORY },
    logCustomAction: {
      command: DESKTOP_COMMANDS.LOG_CUSTOM_ACTION,
      buildArgs: ([name, actionType, details]) => ({
        name,
        actionType,
        details,
      }),
    },
    logCommandRun: {
      command: DESKTOP_COMMANDS.LOG_COMMAND_RUN,
      buildArgs: ([record]) => ({ record }),
    },
    openActionLog: { command: DESKTOP_COMMANDS.OPEN_ACTION_LOG },
    logClientMessage: {
      command: DESKTOP_COMMANDS.LOG_CLIENT_MESSAGE,
      buildArgs: ([level, message, context]) => ({ level, message, context }),
    },
    answerExternalAccess: {
      command: DESKTOP_COMMANDS.ANSWER_EXTERNAL_ACCESS,
      buildArgs: ([jobId, decision]) => ({ jobId, decision }),
    },
    claimExternalJob: {
      command: DESKTOP_COMMANDS.CLAIM_EXTERNAL_JOB,
      buildArgs: ([id]) => ({ id }),
    },
    finishExternalJob: {
      command: DESKTOP_COMMANDS.FINISH_EXTERNAL_JOB,
      buildArgs: ([id, completion]) => ({ id, completion }),
    },
    setToolCatalog: {
      command: DESKTOP_COMMANDS.SET_TOOL_CATALOG,
      buildArgs: ([tools]) => ({ tools }),
    },
    getUserConfig: { command: DESKTOP_COMMANDS.GET_USER_CONFIG },
    copyText: {
      command: DESKTOP_COMMANDS.COPY_TEXT,
      buildArgs: ([text]) => ({ text }),
    },
    replaceSelectionWithCommand: {
      command: DESKTOP_COMMANDS.REPLACE_SELECTION_WITH_COMMAND,
      buildArgs: ([commandId]) => ({ commandId }),
    },
  }
}
