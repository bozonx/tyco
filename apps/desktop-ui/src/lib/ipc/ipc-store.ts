import {
  DEFAULT_INIT_PARAMS,
  DESKTOP_COMMANDS,
  type DesktopCommandName,
  type InitParams,
  type IpcResult,
  type UserConfig,
  type LocalState,
} from '@tyco/shared'
import { ref } from 'vue'

import type {
  DesktopCallArgs,
  DesktopFunctionArgs,
  DesktopFunctionName,
  DesktopFunctionResult,
  DesktopFunctions,
} from './desktop-functions'

export interface DesktopInvoker {
  invoke: <T>(
    command: string,
    args?: Record<string, unknown>
  ) => Promise<IpcResult<T>>
  getInitParams: () => InitParams
  /** Whether the Tauri runtime is there, i.e. not a plain browser */
  isAvailable: () => boolean
}

export interface IpcStoreDeps {
  desktopClient: DesktopInvoker
  notifyError: (message: string, title: string) => void
  logError: (message: string, error: unknown) => void
  /** Title of the notification about a failed desktop function */
  errorTitle?: () => string
  /** Resolves once the user has released the keys held in this window. */
  waitForKeysReleased?: () => Promise<void>
}

type CommandEntry<Args extends unknown[]> = {
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
    saveUserConfig: {
      command: DESKTOP_COMMANDS.SAVE_USER_CONFIG,
      buildArgs: ([userConfig]) => ({ userConfig }),
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
      buildArgs: ([text]) => ({ text }),
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
    putIntoClipboardAndClose: {
      command: DESKTOP_COMMANDS.PUT_INTO_CLIPBOARD_AND_CLOSE,
      buildArgs: ([text]) => ({ text }),
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
    logClientMessage: {
      command: DESKTOP_COMMANDS.LOG_CLIENT_MESSAGE,
      buildArgs: ([level, message, context]) => ({ level, message, context }),
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

export function createIpcStoreModel(deps: IpcStoreDeps) {
  const params = ref<InitParams>(structuredClone(DEFAULT_INIT_PARAMS))
  // writes are refused until the real params arrive: saving the defaults
  // would overwrite what the user has
  let paramsLoaded = !deps.desktopClient.isAvailable()
  const commandMap = createCommandMap()

  /**
   * Calls a desktop function. It never throws: a failure comes back as
   * `success: false`, and the caller decides how to tell the user
   */
  const callFunction = async <K extends DesktopFunctionName>(
    functionName: K,
    ...[args]: DesktopCallArgs<K>
  ): Promise<IpcResult<DesktopFunctionResult<K>>> => {
    try {
      // the name may come from untyped code, e.g. a plugin
      const mappedCommand = Object.hasOwn(commandMap, functionName)
        ? (commandMap[functionName] as CommandEntry<DesktopFunctionArgs<K>>)
        : undefined

      if (!mappedCommand) {
        return {
          success: false,
          error: `Unknown desktop function: ${functionName}`,
        }
      }

      if (mappedCommand.waitForKeysReleased) {
        await deps.waitForKeysReleased?.()
      }

      return await deps.desktopClient.invoke<DesktopFunctionResult<K>>(
        mappedCommand.command,
        mappedCommand.buildArgs?.((args ?? []) as DesktopFunctionArgs<K>)
      )
    } catch (error) {
      deps.logError('Error calling function:', error)

      return { success: false, error: String(error) }
    }
  }

  const reportFailure = (functionName: string, result: IpcResult) => {
    const message = result.error || functionName
    deps.notifyError(message, deps.errorTitle?.() ?? 'Desktop action failed')
    deps.logError(`Desktop function "${functionName}" failed:`, message)
  }

  /**
   * Calls a desktop function whose failure the user has to hear about while the
   * caller has nothing else to do with it, e.g. an insertion
   */
  const callFunctionOrNotify = async <K extends DesktopFunctionName>(
    functionName: K,
    ...args: DesktopCallArgs<K>
  ): Promise<IpcResult<DesktopFunctionResult<K>>> => {
    const result = await callFunction(functionName, ...args)
    if (!result.success) reportFailure(functionName, result)
    return result
  }

  const loadInitialParams = async (): Promise<InitParams> => {
    if (!deps.desktopClient.isAvailable()) {
      const fallback = deps.desktopClient.getInitParams()
      params.value = fallback
      return fallback
    }

    const result = await deps.desktopClient.invoke<InitParams>(
      DESKTOP_COMMANDS.GET_INIT_PARAMS
    )

    if (!result.success || !result.result) {
      const error = new Error(
        `Could not load the app params: ${result.error ?? 'empty response'}`
      )
      reportFailure('getInitParams', { success: false, error: error.message })
      throw error
    }

    params.value = result.result
    paramsLoaded = true
    return result.result
  }

  const setParams = (incomingData: Partial<InitParams>) => {
    params.value = { ...params.value, ...incomingData }
  }

  const notLoaded = (): IpcResult<never> => ({
    success: false,
    error: 'The app params are not loaded yet',
  })

  const saveUserConfig = async (userConfig: UserConfig) => {
    if (!paramsLoaded) return notLoaded()

    const result = await callFunction('saveUserConfig', [userConfig])

    if (result.success) {
      params.value.userConfig = userConfig
    }

    return result
  }

  /** The backend merges the patch, so concurrent patches never undo each other */
  const patchLocalState = async (patch: Partial<LocalState>) => {
    if (!paramsLoaded) return notLoaded()

    const result = await callFunction('patchLocalState', [patch])

    if (result.success) {
      params.value.localState = result.result ?? {
        ...params.value.localState,
        ...patch,
      }
    }

    return result
  }

  return {
    params,
    callFunction,
    callFunctionOrNotify,
    loadInitialParams,
    setParams,
    saveUserConfig,
    patchLocalState,
  }
}
