import type {
  DesktopCommandArgs,
  DesktopCommandName,
  DesktopCommandResult,
} from './generated/desktop-commands'

/** The arguments may be left out when a command takes none */
export type DesktopInvokeArgs<K extends DesktopCommandName> =
  DesktopCommandArgs<K> extends undefined
    ? [args?: undefined]
    : [args: DesktopCommandArgs<K>]

/** Calls a desktop command; a failure rejects with a `DesktopIpcError` */
export type DesktopInvoke = <K extends DesktopCommandName>(
  command: K,
  ...args: DesktopInvokeArgs<K>
) => Promise<DesktopCommandResult<K>>
