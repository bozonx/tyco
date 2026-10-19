import type { SocketOpener, SocketSession } from '@bozonx/ai-kit'

import { DesktopIpcError } from '../desktop/ipc-error'
import { createAsyncQueue } from './async-queue'
import {
  abortReason,
  errorMessage,
  isArrayBuffer,
  type NetIpc,
  type SocketEvent,
} from './net-ipc'

// Bound both native frames and the pending IPC promise chain.
const MAX_FRAME_BYTES = 256 * 1024
const MAX_PENDING_BYTES = 1024 * 1024
const MAX_PENDING_SENDS = 128

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

    const queue = createAsyncQueue<string>({
      sizeOf: (value) => new TextEncoder().encode(value).byteLength,
      onOverflow: (error) => abortWith(error),
    })
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
        void ipc.invoke('cancel_net_task', { id }).catch(() => undefined)
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
      .invoke('open_socket', {
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
    let pendingBytes = 0
    let pendingSends = 0
    const encoder = new TextEncoder()
    let outgoing = Promise.resolve()
    let closeRequested = false
    let sendFailed = false

    const enqueue = (
      send: () => Promise<unknown>,
      size: number,
      cleanup = false
    ) => {
      if (
        size > MAX_FRAME_BYTES ||
        (!cleanup &&
          (pendingBytes + size > MAX_PENDING_BYTES ||
            pendingSends >= MAX_PENDING_SENDS))
      ) {
        abortWith(
          new DesktopIpcError(
            'resourceLimit',
            'WebSocket send queue limit exceeded',
            undefined
          )
        )
        return
      }
      pendingBytes += size
      pendingSends += 1
      outgoing = outgoing
        .then(() => {
          if (closed || (!cleanup && sendFailed)) return
          return send()
        })
        .then(
          () => undefined,
          (error: unknown) => {
            if (closed) return
            if (cleanup) {
              abortWith(new Error(errorMessage(error), { cause: error }))
              return
            }
            if (sendFailed) return
            sendFailed = true
            queue.fail(new Error(errorMessage(error), { cause: error }))
            close()
          }
        )
        .finally(() => {
          pendingBytes -= size
          pendingSends -= 1
        })
    }

    /** With `finalMessage`, sends it and lets the server close */
    const close = (finalMessage?: string) => {
      if (closed) return
      if (closeRequested) {
        if (finalMessage !== undefined) return
        // The protocol has finished flushing; release a server that stays open.
        closed = true
        detach()
        queue.end()
        cancelRemote()
        return
      }
      closeRequested = true
      enqueue(
        () =>
          ipc.invoke('close_socket', {
            id: id!,
            finalMessage: finalMessage ?? null,
          }),
        finalMessage === undefined
          ? 0
          : encoder.encode(finalMessage).byteLength,
        true
      )
    }

    const session: SocketSession = {
      messages: queue.values,
      send(data) {
        if (closeRequested || closed) return
        if (typeof data === 'string') {
          enqueue(
            () => ipc.invoke('send_socket_text', { id: id!, text: data }),
            encoder.encode(data).byteLength
          )
          return
        }
        enqueue(
          () =>
            ipc.invoke('send_socket_binary', {
              bytes: data,
              meta: { id: id! },
            }),
          data.byteLength
        )
      },
      close,
    }

    return session
  }
}
