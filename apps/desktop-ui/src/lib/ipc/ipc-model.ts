import { createCommandMap, type CommandEntry } from './command-map'
import {
  type DesktopViewState,
  type DesktopCommandName,
  type DesktopInvokeArgs,
  type DesktopCommandResult,
  type IpcResult,
} from '@tyco/shared'

import type {
  DesktopCallArgs,
  DesktopFunctionArgs,
  DesktopFunctionName,
  DesktopFunctionResult,
  NativeCommand,
} from './desktop-functions'

export interface DesktopInvoker {
  invoke: <K extends DesktopCommandName>(
    command: K,
    ...args: DesktopInvokeArgs<K>
  ) => Promise<IpcResult<DesktopCommandResult<K>>>
  getDesktopViewState: () => DesktopViewState
  /** Whether the Tauri runtime is there, i.e. not a plain browser */
  isAvailable: () => boolean
}

export interface IpcModelDependencies {
  desktopClient: DesktopInvoker
  notifyError: (message: string, title: string) => void
  logError: (message: string, error: unknown) => void
  /** Title of the notification about a failed desktop function */
  errorTitle?: () => string
  /** Resolves once the user has released the keys held in this window. */
  waitForKeysReleased?: () => Promise<void>
  /** The activation a call belongs to, for the commands that carry it */
  getActivationId: () => number
}

export function createIpcModel(deps: IpcModelDependencies) {
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
        ? (commandMap[functionName] as CommandEntry<
            DesktopFunctionArgs<K>,
            NativeCommand<K>
          >)
        : undefined

      if (!mappedCommand) {
        return {
          success: false,
          error: `Unknown desktop function: ${functionName}`,
        }
      }

      const activationId = deps.getActivationId()
      if (mappedCommand.waitForKeysReleased) {
        await deps.waitForKeysReleased?.()
      }

      return await deps.desktopClient.invoke(
        mappedCommand.command,
        ...([
          mappedCommand.buildArgs?.((args ?? []) as DesktopFunctionArgs<K>, {
            activationId,
          }),
        ] as DesktopInvokeArgs<NativeCommand<K>>)
      )
    } catch (error) {
      deps.logError('Error calling function:', error)

      return { success: false, error: String(error) }
    }
  }

  const reportFailure = (functionName: string, result: IpcResult) => {
    const message = result.success ? functionName : result.error
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

  return {
    callFunction,
    callFunctionOrNotify,
    /** Tells the user that the desktop function `name` failed */
    reportFailure: (name: string, message: string) =>
      reportFailure(name, { success: false, error: message }),
  }
}
