/**
 * The IPC surface the network adapters need, injected so they run in tests
 * without a Tauri runtime.
 *
 * Requests leave from the Rust side (`src-tauri/src/services/net`): no CORS,
 * and provider keys are filled in there, so the webview never holds one.
 */
export interface NetIpc {
  invoke: <T>(
    command: string,
    args?: Record<string, unknown> | Uint8Array,
    options?: { headers?: Record<string, string> }
  ) => Promise<T>
  /**
   * A channel object to pass as a command argument. JSON messages arrive
   * parsed, raw byte messages as an `ArrayBuffer`.
   */
  createChannel: (onMessage: (message: unknown) => void) => unknown
}

export type FetchEvent =
  | {
      type: 'head'
      status: number
      statusText: string
      headers: [string, string][]
    }
  | { type: 'end' }
  | { type: 'error'; message: string }

export type SocketEvent =
  | { type: 'message'; data: string }
  | { type: 'close'; code: number; reason: string }
  | { type: 'error'; message: string }

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
  return error instanceof Error ? error.message : String(error)
}
