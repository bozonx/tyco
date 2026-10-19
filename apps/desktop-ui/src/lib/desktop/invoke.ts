import {
  BINARY_DESKTOP_COMMANDS,
  type BinaryArgs,
  type DesktopCommandName,
  type DesktopInvoke,
} from '@tyco/shared'
import { invoke } from '@tauri-apps/api/core'
import { normalizeDesktopError } from './ipc-error'

/** Carries the `meta` of a binary argument; see `src-tauri/src/ipc.rs` */
export const BINARY_META_HEADER = 'x-tyco-meta'

const BINARY_COMMANDS: ReadonlySet<DesktopCommandName> = new Set(
  BINARY_DESKTOP_COMMANDS
)

/**
 * Calls a command through Tauri: a binary argument goes as the raw body with
 * its metadata in a header, a failure rejects with a `DesktopIpcError`
 */
export const invokeDesktop: DesktopInvoke = async (command, ...[args]) => {
  try {
    if (BINARY_COMMANDS.has(command)) {
      const { bytes, meta } = args as BinaryArgs<unknown>
      return await invoke(command, bytes, {
        // headers are ASCII; the metadata may hold any name
        headers: {
          [BINARY_META_HEADER]: encodeURIComponent(JSON.stringify(meta)),
        },
      })
    }
    return await invoke(command, args as Record<string, unknown> | undefined)
  } catch (error) {
    throw normalizeDesktopError(error)
  }
}
