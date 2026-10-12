import type { DesktopInvoke, DesktopChannel } from '@tyco/shared'
import { desktopErrorMessage } from '../desktop/ipc-error'
/**
 * The IPC surface the network adapters need, injected so they run in tests
 * without a Tauri runtime.
 *
 * Requests leave from the Rust side (`src-tauri/src/services/net`): no CORS,
 * and provider keys are filled in there, so the webview never holds one.
 */
export interface NetIpc {
  invoke: DesktopInvoke
  /**
   * A channel object to pass as a command argument. JSON messages arrive
   * parsed, raw byte messages as an `ArrayBuffer`.
   */
  createChannel: (onMessage: (message: unknown) => void) => DesktopChannel
}

export type { FetchEvent, SocketEvent } from '@tyco/shared'

/** Names the socket a raw binary frame is for; see `commands/net.rs`. */
export const SOCKET_ID_HEADER = 'x-tyco-socket-id'

export function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException('The operation was aborted.', 'AbortError')
  )
}

/** Raw channel messages; a tag check, so a buffer from another realm counts */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

export function errorMessage(error: unknown): string {
  return desktopErrorMessage(error)
}
