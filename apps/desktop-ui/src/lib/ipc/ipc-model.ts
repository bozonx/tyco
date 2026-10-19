import {
  ACTIVATION_DESKTOP_COMMANDS,
  type DesktopCommandArgs,
  type DesktopCommandName,
  type DesktopCommandResult,
  type DesktopInvokeArgs,
  type DesktopViewState,
  type IpcResult,
} from '@tyco/shared'

export interface DesktopInvoker {
  invoke: <K extends DesktopCommandName>(
    command: K,
    ...args: DesktopInvokeArgs<K>
  ) => Promise<IpcResult<DesktopCommandResult<K>>>
  getDesktopViewState: () => DesktopViewState
  /** Whether the Tauri runtime is there, i.e. not a plain browser */
  isAvailable: () => boolean
}

type ActivationCommand = (typeof ACTIVATION_DESKTOP_COMMANDS)[number]

type WithoutActivation<K extends DesktopCommandName> = Omit<
  DesktopCommandArgs<K>,
  'activationId'
>

/** The arguments of a command as callers give them: without `activationId` */
export type DesktopCallArgs<K extends DesktopCommandName> =
  K extends ActivationCommand
    ? keyof WithoutActivation<K> extends never
      ? undefined
      : WithoutActivation<K>
    : DesktopCommandArgs<K>

/** Arguments that may all be left out may be left out together */
export type DesktopCallParams<K extends DesktopCommandName> =
  DesktopCallArgs<K> extends undefined
    ? [args?: undefined]
    : object extends DesktopCallArgs<K>
      ? [args?: DesktopCallArgs<K>]
      : [args: DesktopCallArgs<K>]

export type DesktopCall = <K extends DesktopCommandName>(
  command: K,
  ...args: DesktopCallParams<K>
) => Promise<IpcResult<DesktopCommandResult<K>>>

/**
 * Commands that press keys in the window Tyco hides: keys the user still holds
 * would mix in with them
 */
const COMMANDS_AFTER_KEY_RELEASE: ReadonlySet<DesktopCommandName> = new Set([
  'paste_into_target_and_hide',
])

const ACTIVATION_COMMANDS: ReadonlySet<string> = new Set(
  ACTIVATION_DESKTOP_COMMANDS
)

export interface IpcModelDependencies {
  desktopClient: DesktopInvoker
  notifyError: (message: string, title: string) => void
  logError: (message: string, error: unknown) => void
  /** Title of the notification about a failed desktop command */
  errorTitle?: () => string
  /** Resolves once the user has released the keys held in this window. */
  waitForKeysReleased?: () => Promise<void>
  /** The activation the window shows, for the commands that act for it */
  getActivationId: () => number
}

export function createIpcModel(deps: IpcModelDependencies) {
  /**
   * Calls a desktop command. It never throws: a failure comes back as `success:
   * false`, and the caller decides how to tell the user
   */
  const call: DesktopCall = async (command, ...[args]) => {
    try {
      const activationId = deps.getActivationId()
      if (COMMANDS_AFTER_KEY_RELEASE.has(command))
        await deps.waitForKeysReleased?.()
      const commandArgs = ACTIVATION_COMMANDS.has(command)
        ? { ...args, activationId }
        : args
      return await deps.desktopClient.invoke(
        command,
        ...([commandArgs] as DesktopInvokeArgs<typeof command>)
      )
    } catch (error) {
      deps.logError('Error calling a desktop command:', error)
      return { success: false, error: String(error) }
    }
  }

  const reportFailure = (command: string, message: string) => {
    deps.notifyError(message, deps.errorTitle?.() ?? 'Desktop action failed')
    deps.logError(`Desktop command "${command}" failed:`, message)
  }

  /**
   * Calls a desktop command whose failure the user has to hear about while the
   * caller has nothing else to do with it, e.g. an insertion
   */
  const callOrNotify: DesktopCall = async (command, ...args) => {
    const result = await call(command, ...args)
    if (!result.success) reportFailure(command, result.error)
    return result
  }

  return {
    call,
    callOrNotify,
    /** Tells the user that the desktop command `command` failed */
    reportFailure,
  }
}
