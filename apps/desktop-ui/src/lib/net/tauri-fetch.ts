import type { FetchFunction } from '@bozonx/ai-kit'

import { DEFAULT_MAX_QUEUED_BYTES } from './async-queue'
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
export function createTauriFetch(
  ipc: NetIpc,
  purpose?: 'chat-image' | 'webhook'
): FetchFunction {
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

    // Body encoding is asynchronous; cancellation may happen while it runs.
    if (signal?.aborted) throw abortReason(signal)

    return await new Promise<Response>((resolve, reject) => {
      let id: number | undefined
      let headReceived = false
      let finished = false
      let cancelRequested = false
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      const chunks: Uint8Array[] = []
      let queuedBytes = 0
      let ended = false
      let pendingAcknowledgements = 0

      const acknowledge = () => {
        if (id === undefined) {
          pendingAcknowledgements += 1
          return
        }
        void ipc
          .invoke('acknowledge_fetch_chunk', { id })
          .catch((error: unknown) => {
            if (finished) return
            finish()
            cancelRemote()
            fail(new TypeError(errorMessage(error)))
          })
      }

      const flush = () => {
        if (finished || !headReceived) return
        if ((controller?.desiredSize ?? 0) > 0 && chunks.length > 0) {
          const chunk = chunks.shift()!
          queuedBytes -= chunk.byteLength
          controller!.enqueue(chunk)
          acknowledge()
        }
        if (ended && chunks.length === 0) {
          finish()
          controller?.close()
        }
      }

      const cancelRemote = () => {
        if (id === undefined) {
          cancelRequested = true
          return
        }
        void ipc.invoke('cancel_net_task', { id }).catch(() => undefined)
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
        pull() {
          flush()
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
          queuedBytes += message.byteLength
          if (queuedBytes > DEFAULT_MAX_QUEUED_BYTES) {
            finish()
            cancelRemote()
            fail(new TypeError('HTTP receive queue limit exceeded'))
            return
          }
          chunks.push(new Uint8Array(message))
          flush()
          return
        }

        const event = message as FetchEvent

        switch (event.type) {
          case 'head': {
            if (event.status < 200 || event.status > 599) {
              finish()
              cancelRemote()
              reject(new TypeError('Unsupported HTTP response status'))
              break
            }
            const nullBody =
              request.method === 'HEAD' || NULL_BODY_STATUSES.has(event.status)
            try {
              const response = new Response(nullBody ? null : stream, {
                status: event.status,
                statusText: event.statusText,
                headers: event.headers,
              })
              headReceived = true
              resolve(response)
            } catch (error) {
              finish()
              cancelRemote()
              reject(new TypeError(errorMessage(error)))
              break
            }
            if (nullBody) {
              finish()
              cancelRemote()
            } else flush()
            break
          }
          case 'end':
            ended = true
            flush()
            break
          case 'error':
            finish()
            fail(new TypeError(event.message))
            break
        }
      }

      signal?.addEventListener('abort', onAbort, { once: true })

      ipc
        .invoke('start_fetch', {
          request: {
            method: request.method,
            url: request.url,
            headers: [...request.headers],
            body: body && bytesToBase64(body),
            ...(purpose ? { purpose } : {}),
          },
          onEvent: ipc.createChannel(onMessage),
        })
        .then(
          (value) => {
            id = value
            if (cancelRequested) cancelRemote()
            const count = pendingAcknowledgements
            pendingAcknowledgements = 0
            for (let index = 0; index < count; index += 1) acknowledge()
          },
          (error: unknown) => {
            if (finished) return
            finish()
            fail(new TypeError(errorMessage(error)))
          }
        )
    })
  }
}
