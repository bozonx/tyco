import {
  DEFAULT_INIT_PARAMS,
  DESKTOP_COMMANDS,
  type InitParams,
  type IpcResult,
  type UserConfig,
  type LocalState,
} from '@shared'
import { ref } from 'vue'

export interface DesktopInvoker {
  invoke: <T>(
    command: string,
    args?: Record<string, unknown>
  ) => Promise<IpcResult<T>>
  getInitParams: () => InitParams
}

export interface IpcStoreDeps {
  desktopClient: DesktopInvoker
  notifyError: (message: string, title: string) => void
  logError: (message: string, error: unknown) => void
}

type CommandEntry = {
  command?: string
  invoke?: (args: unknown[]) => Promise<IpcResult>
  buildArgs?: (args: unknown[]) => Record<string, unknown>
}

export function createCommandMap(): Record<string, CommandEntry> {
  return {
    saveUserConfig: {
      command: DESKTOP_COMMANDS.SAVE_USER_CONFIG,
      buildArgs: ([userConfigJson]) => ({ userConfigJson }),
    },
    saveLocalState: {
      command: DESKTOP_COMMANDS.SAVE_LOCAL_STATE,
      buildArgs: ([localState]) => ({ localState }),
    },
    getStorageInfo: {
      command: DESKTOP_COMMANDS.GET_STORAGE_INFO,
    },
    getEditorHistory: {
      command: DESKTOP_COMMANDS.GET_EDITOR_HISTORY,
    },
    getTransformHistory: {
      command: DESKTOP_COMMANDS.GET_TRANSFORM_HISTORY,
    },
    getChatHistory: {
      command: DESKTOP_COMMANDS.GET_CHAT_HISTORY,
    },
    getChat: {
      command: DESKTOP_COMMANDS.GET_CHAT,
      buildArgs: ([id]) => ({ id }),
    },
    saveMainInputTmp: {
      command: DESKTOP_COMMANDS.SAVE_MAIN_INPUT_TMP,
      buildArgs: ([value]) => ({ value }),
    },
    clearMainInputTmp: {
      command: DESKTOP_COMMANDS.CLEAR_MAIN_INPUT_TMP,
    },
    saveEditorHistory: {
      command: DESKTOP_COMMANDS.SAVE_EDITOR_HISTORY,
      buildArgs: ([value]) => ({ value }),
    },
    saveTransformHistory: {
      command: DESKTOP_COMMANDS.SAVE_TRANSFORM_HISTORY,
      buildArgs: ([value]) => ({ value }),
    },
    saveChatHistory: {
      command: DESKTOP_COMMANDS.SAVE_CHAT_HISTORY,
      buildArgs: ([chatHistoryItem]) => ({ chatHistoryItem }),
    },
    removeFromEditorHistory: {
      command: DESKTOP_COMMANDS.REMOVE_FROM_EDITOR_HISTORY,
      buildArgs: ([value]) => ({ value }),
    },
    removeFromTransformHistory: {
      command: DESKTOP_COMMANDS.REMOVE_FROM_TRANSFORM_HISTORY,
      buildArgs: ([value]) => ({ value }),
    },
    removeFromChatHistory: {
      command: DESKTOP_COMMANDS.REMOVE_FROM_CHAT_HISTORY,
      buildArgs: ([id]) => ({ id }),
    },
    clearEditorHistory: {
      command: DESKTOP_COMMANDS.CLEAR_EDITOR_HISTORY,
    },
    clearTransformHistory: {
      command: DESKTOP_COMMANDS.CLEAR_TRANSFORM_HISTORY,
    },
    clearChatHistory: {
      command: DESKTOP_COMMANDS.CLEAR_CHAT_HISTORY,
    },
    startVoiceRecognition: {
      command: DESKTOP_COMMANDS.START_VOICE_RECOGNITION,
    },
    stopVoiceRecognition: {
      command: DESKTOP_COMMANDS.STOP_VOICE_RECOGNITION,
    },
    startLocalVoiceRecording: {
      command: DESKTOP_COMMANDS.START_LOCAL_VOICE_RECORDING,
    },
    stopLocalVoiceRecording: {
      command: DESKTOP_COMMANDS.STOP_LOCAL_VOICE_RECORDING,
    },
    typeIntoWindowAndClose: {
      command: DESKTOP_COMMANDS.TYPE_INTO_WINDOW_AND_CLOSE,
      buildArgs: ([text]) => ({ text }),
    },
    putIntoClipboardAndClose: {
      command: DESKTOP_COMMANDS.PUT_INTO_CLIPBOARD_AND_CLOSE,
      buildArgs: ([text]) => ({ text }),
    },
    openInBrowserAndClose: {
      command: DESKTOP_COMMANDS.OPEN_IN_BROWSER_AND_CLOSE,
      buildArgs: ([url]) => ({ url: String(url) }),
    },
  }
}

export function createIpcStoreModel(deps: IpcStoreDeps) {
  const params = ref<InitParams>(structuredClone(DEFAULT_INIT_PARAMS))
  const commandMap = createCommandMap()

  const callFunction = async (
    functionName: string,
    args: unknown[] = []
  ): Promise<IpcResult> => {
    try {
      const mappedCommand = commandMap[functionName]

      if (!mappedCommand) {
        return {
          success: false,
          error: `Unknown desktop function: ${functionName}`,
        }
      }

      if (mappedCommand.invoke) {
        return await mappedCommand.invoke(args)
      }

      return await deps.desktopClient.invoke(
        mappedCommand.command!,
        mappedCommand.buildArgs?.(args)
      )
    } catch (error) {
      deps.notifyError(String(error), 'Api call error')
      deps.logError('Error calling function:', error)

      return { success: false, error: String(error) }
    }
  }

  const loadInitialParams = async (): Promise<InitParams> => {
    const result = await deps.desktopClient.invoke<InitParams>(
      DESKTOP_COMMANDS.GET_INIT_PARAMS
    )

    if (result.success && result.result) {
      params.value = result.result
      return result.result
    }

    const fallback = deps.desktopClient.getInitParams()
    params.value = fallback

    return fallback
  }

  const setParams = (incomingData: InitParams) => {
    params.value = { ...params.value, ...incomingData }
  }

  const saveUserConfig = async (userConfig: UserConfig) => {
    const result = await callFunction('saveUserConfig', [JSON.stringify(userConfig)])

    if (result.success) {
      params.value.userConfig = userConfig
    }

    return result
  }

  const saveLocalState = async (localState: LocalState) => {
    const result = await callFunction('saveLocalState', [localState])

    if (result.success) {
      params.value.localState = localState
    }

    return result
  }

  const patchLocalState = async (patch: Partial<LocalState>) => {
    return await saveLocalState({ ...params.value.localState, ...patch })
  }

  return {
    params,
    callFunction,
    loadInitialParams,
    setParams,
    saveUserConfig,
    saveLocalState,
    patchLocalState,
  }
}
