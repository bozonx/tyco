import { createCommandMap, type CommandEntry } from './command-map'
import {
  DEFAULT_INIT_PARAMS,
  DESKTOP_COMMANDS,
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

export function createIpcStoreModel(deps: IpcStoreDeps) {
  const params = ref<InitParams>(structuredClone(DEFAULT_INIT_PARAMS))
  // writes are refused until the real params arrive: saving the defaults
  // would overwrite what the user has
  let paramsLoaded = !deps.desktopClient.isAvailable()
  const commandMap = createCommandMap()
  let localStateWrites: Promise<unknown> = Promise.resolve()

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

  const saveUserConfig = async (
    userConfig: UserConfig,
    baseConfig: UserConfig = params.value.userConfig
  ) => {
    if (!paramsLoaded) return notLoaded()

    const previousConfig = params.value.userConfig
    const result = await callFunction('saveUserConfig', [
      userConfig,
      baseConfig,
    ])

    // A newer params event may have arrived while this save was in flight.
    if (result.success && params.value.userConfig === previousConfig) {
      params.value.userConfig = result.result ?? userConfig
    }

    return result
  }

  /** Serializes patches so an older full response cannot undo a newer one. */
  const patchLocalState = (patch: Partial<LocalState>) => {
    if (!paramsLoaded) return Promise.resolve(notLoaded())
    const queuedPatch = { ...patch }
    const write = localStateWrites.then(async () => {
      const previousState = params.value.localState
      const result = await callFunction('patchLocalState', [queuedPatch])

      // A cross-window state event may already carry a newer snapshot.
      if (result.success && params.value.localState === previousState) {
        params.value.localState = result.result ?? {
          ...params.value.localState,
          ...queuedPatch,
        }
      }
      return result
    })
    localStateWrites = write.catch(() => undefined)
    return write
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
