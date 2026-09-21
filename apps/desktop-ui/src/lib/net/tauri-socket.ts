import type { SocketOpener, SocketSession } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS } from '@tyco/shared'

import { createAsyncQueue } from './async-queue'
import {
  abortReason,
  errorMessage,
  isArrayBuffer,
  type NetIpc,
  SOCKET_ID_HEADER,
  type SocketEvent,
} from './net-ipc'

/** Close codes `@bozonx/ai-kit` treats as a normal end of a session */
const NORMAL_CLOSE_CODES = new Set([1000, 1005])

/**
 * A WebSocket opened from the Rust side, which can send the handshake headers
 * speech providers authenticate with — the webview's own `WebSocket` cannot.
 */
export function createTauriSocketOpener(ipc: NetIpc): SocketOpener {
  return async (url, options) => {
    const { signal } = options

    if (signal.aborted) {
      throw abortReason(signal)
    }

    const queue = createAsyncQueue<string>()
    const decoder = new TextDecoder()
    let closed = false

    const onMessage = (message: unknown) => {
      if (isArrayBuffer(message)) {
        queue.push(decoder.decode(message))
        return
      }

      const event = message as SocketEvent

      switch (event.type) {
        case 'message':
          queue.push(event.data)
          break
        case 'close':
          closed = true
          if (NORMAL_CLOSE_CODES.has(event.code)) {
            queue.end()
          } else {
            const reason = event.reason ? `: ${event.reason}` : ''
            queue.fail(new Error(`closed with ${event.code}${reason}`))
          }
          break
        case 'error':
          closed = true
          queue.fail(new Error(event.message))
          break
      }
    }

    let id: number
    try {
      id = await ipc.invoke<number>(DESKTOP_COMMANDS.NET_SOCKET_OPEN, {
        request: {
          url,
          headers: Object.entries(options.headers ?? {}),
          protocols: options.protocols ?? [],
        },
        onEvent: ipc.createChannel(onMessage),
      })
    } catch (error) {
      throw new Error(errorMessage(error), { cause: error })
    }

    // Frames are separate IPC calls, which may be handled out of order; a
    // chain keeps audio and the closing message in the order they were sent.
    let outgoing = Promise.resolve()
    let closeRequested = false

    const enqueue = (send: () => Promise<unknown>) => {
      outgoing = outgoing.then(send).then(
        () => undefined,
        () => undefined
      )
    }

    const close = (payload?: string) => {
      if (closeRequested || closed) return
      closeRequested = true
      signal.removeEventListener('abort', onAbort)
      enqueue(() =>
        ipc.invoke(DESKTOP_COMMANDS.NET_SOCKET_CLOSE, {
          id,
          payload: payload ?? null,
        })
      )
    }

    const onAbort = () => close()
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    const session: SocketSession = {
      messages: queue.values,
      send(data) {
        if (closeRequested || closed) return
        if (typeof data === 'string') {
          enqueue(() =>
            ipc.invoke(DESKTOP_COMMANDS.NET_SOCKET_SEND_TEXT, {
              id,
              text: data,
            })
          )
          return
        }
        enqueue(() =>
          ipc.invoke(DESKTOP_COMMANDS.NET_SOCKET_SEND_BINARY, data, {
            headers: { [SOCKET_ID_HEADER]: String(id) },
          })
        )
      },
      close,
    }

    return session
  }
}
