import type { FetchFunction } from '@bozonx/ai-kit'
import { DESKTOP_COMMANDS } from '@tyco/shared'

import { bytesToBase64 } from './base64'
import {
  abortReason,
  errorMessage,
  isArrayBuffer,
  type FetchEvent,
  type NetIpc,
} from './net-ipc'

/** Statuses a `Response` must be built without a body for */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

const BODYLESS_METHODS = new Set(['GET', 'HEAD'])

/**
 * A `fetch` that sends the request from the Rust side.
 *
 * Behaves like the platform one where callers can tell: it resolves on the
 * response head, streams the body, rejects with a `TypeError` on a network
 * failure and with the signal's reason on abort.
 */
export function createTauriFetch(ipc: NetIpc): FetchFunction {
  return async (input, init) => {
    // Normalizes every accepted input shape, and encodes `FormData` with the
    // boundary in `content-type`.
    const request = new Request(input, init)
    const signal = init?.signal ?? request.signal

    if (signal?.aborted) {
      throw abortReason(signal)
    }

    const body = BODYLESS_METHODS.has(request.method)
      ? undefined
      : new Uint8Array(await request.arrayBuffer())

    return await new Promise<Response>((resolve, reject) => {
      let id: number | undefined
      let headReceived = false
      let finished = false
      let cancelRequested = false
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined

      const cancelRemote = () => {
        if (id === undefined) {
          cancelRequested = true
          return
        }
        void ipc
          .invoke(DESKTOP_COMMANDS.NET_CANCEL, { id })
          .catch(() => undefined)
      }

      const finish = () => {
        finished = true
        signal?.removeEventListener('abort', onAbort)
      }

      const fail = (error: unknown) => {
        if (headReceived) {
          controller?.error(error)
        } else {
          reject(error)
        }
      }

      const onAbort = () => {
        if (finished) return
        finish()
        cancelRemote()
        fail(abortReason(signal!))
      }

      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController
        },
        cancel() {
          if (finished) return
          finish()
          cancelRemote()
        },
      })

      const onMessage = (message: unknown) => {
        if (finished) return

        if (isArrayBuffer(message)) {
          controller?.enqueue(new Uint8Array(message))
          return
        }

        const event = message as FetchEvent

        switch (event.type) {
          case 'head': {
            headReceived = true
            const nullBody = NULL_BODY_STATUSES.has(event.status)
            resolve(
              new Response(nullBody ? null : stream, {
                status: event.status,
                statusText: event.statusText,
                headers: event.headers,
              })
            )
            if (nullBody) finish()
            break
          }
          case 'end':
            finish()
            controller?.close()
            break
          case 'error':
            finish()
            fail(new TypeError(event.message))
            break
        }
      }

      signal?.addEventListener('abort', onAbort, { once: true })

      ipc
        .invoke<number>(DESKTOP_COMMANDS.NET_FETCH, {
          request: {
            method: request.method,
            url: request.url,
            headers: [...request.headers],
            body: body && bytesToBase64(body),
          },
          onEvent: ipc.createChannel(onMessage),
        })
        .then(
          (value) => {
            id = value
            if (cancelRequested) cancelRemote()
          },
          (error: unknown) => {
            if (finished) return
            finish()
            reject(new TypeError(errorMessage(error)))
          }
        )
    })
  }
}
