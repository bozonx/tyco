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
    const { signal, connectSignal } = options

    if (signal.aborted) throw abortReason(signal)
    if (connectSignal?.aborted) throw abortReason(connectSignal)

    const queue = createAsyncQueue<string>()
    const decoder = new TextDecoder()
    let closed = false
    let id: number | undefined
    let cancelRequested = false
    let resolveOpen!: () => void
    let rejectOpen!: (error: unknown) => void
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve
      rejectOpen = reject
    })
    const cancelRemote = () => {
      cancelRequested = true
      if (id !== undefined) {
        void ipc
          .invoke(DESKTOP_COMMANDS.NET_CANCEL, { id })
          .catch(() => undefined)
      }
    }
    const abortWith = (error: unknown) => {
      if (closed) return
      closed = true
      detach()
      cancelRemote()
      rejectOpen(error)
      queue.fail(error instanceof Error ? error : new Error(String(error)))
    }
    const abort = () => abortWith(abortReason(signal))
    const abortConnect = () => abortWith(abortReason(connectSignal!))
    const detach = () => {
      signal.removeEventListener('abort', abort)
      connectSignal?.removeEventListener('abort', abortConnect)
    }
    signal.addEventListener('abort', abort, { once: true })
    connectSignal?.addEventListener('abort', abortConnect, { once: true })

    const onMessage = (message: unknown) => {
      if (closed) return
      if (isArrayBuffer(message)) {
        queue.push(decoder.decode(message))
        return
      }

      const event = message as SocketEvent

      switch (event.type) {
        case 'open':
          connectSignal?.removeEventListener('abort', abortConnect)
          resolveOpen()
          break
        case 'message':
          queue.push(event.data)
          break
        case 'close':
          closed = true
          detach()
          rejectOpen(new Error('Socket closed before opening'))
          if (NORMAL_CLOSE_CODES.has(event.code)) {
            queue.end()
          } else {
            const reason = event.reason ? `: ${event.reason}` : ''
            queue.fail(new Error(`closed with ${event.code}${reason}`))
          }
          break
        case 'error':
          closed = true
          detach()
          rejectOpen(new Error(event.message))
          queue.fail(new Error(event.message))
          break
      }
    }

    const opening = ipc
      .invoke<number>(DESKTOP_COMMANDS.NET_SOCKET_OPEN, {
        request: {
          url,
          headers: Object.entries(options.headers ?? {}),
          protocols: options.protocols ?? [],
        },
        onEvent: ipc.createChannel(onMessage),
      })
      .then(
        (value) => {
          id = value
          if (cancelRequested) cancelRemote()
        },
        (error: unknown) => {
          const failure = new Error(errorMessage(error), { cause: error })
          rejectOpen(failure)
          throw failure
        }
      )
    try {
      await Promise.all([opening, opened])
    } catch (error) {
      closed = true
      detach()
      throw error
    }

    // Frames are separate IPC calls, which may be handled out of order; a
    // chain keeps audio and the closing message in the order they were sent.
    let outgoing = Promise.resolve()
    let closeRequested = false
    let sendFailed = false

    const enqueue = (send: () => Promise<unknown>, cleanup = false) => {
      outgoing = outgoing
        .then(() => {
          if (closed || (!cleanup && sendFailed)) return
          return send()
        })
        .then(
          () => undefined,
          (error: unknown) => {
            if (sendFailed || closed) return
            sendFailed = true
            queue.fail(new Error(errorMessage(error), { cause: error }))
            close()
          }
        )
    }

    const close = (payload?: string) => {
      if (closeRequested || closed) return
      closeRequested = true
      enqueue(
        () =>
          ipc.invoke(DESKTOP_COMMANDS.NET_SOCKET_CLOSE, {
            id,
            payload: payload ?? null,
          }),
        true
      )
    }

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
