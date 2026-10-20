import { errorMessage } from '@tyco/shared/value-guards'
import {
  assertPluginMessage,
  PLUGIN_RPC_LIMITS,
} from '@tyco/plugin-sdk/runtime'
import { PluginCancellation } from '@tyco/plugin-sdk'

export interface PluginTransport {
  send(message: unknown): void
  listen(handler: (message: unknown) => void): () => void
  close(): void
}
type PluginRequestMethod = 'load' | 'init' | 'invoke' | 'dispose'
interface Request {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  removeAbort(): void
  method: PluginRequestMethod
}
export interface PluginRpcDependencies {
  transport: PluginTransport
  callHost(method: string, args: unknown[]): Promise<unknown>
  onFailure(error: Error): void
  onCleanupError?(error: Error): void
  timeoutMs?: number
  cancellationGraceMs?: number
}

/** Owns one isolated channel. No peer can choose a different plugin identity. */
export function createPluginRpc(deps: PluginRpcDependencies) {
  let sequence = 0
  let closed = false
  const pending = new Map<number, Request>()
  const cancelled = new Map<number, ReturnType<typeof setTimeout>>()
  const hostRequests = new Map<
    number,
    ReturnType<typeof setTimeout> | undefined
  >()
  let initialized = false
  let stopping = false
  function close(
    error: Error = new PluginCancellation('Plugin runtime closed')
  ) {
    if (closed) return
    closed = true
    removeListener()
    deps.transport.close()
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.removeAbort()
      task.reject(error)
    }
    pending.clear()
    for (const timer of cancelled.values()) clearTimeout(timer)
    cancelled.clear()
    for (const timer of hostRequests.values()) clearTimeout(timer)
    hostRequests.clear()
  }
  function fail(error: Error) {
    if (closed) return
    close(error)
    deps.onFailure(error)
  }
  const removeListener = deps.transport.listen((raw) => {
    if (closed || !raw || typeof raw !== 'object') return
    try {
      assertPluginMessage(raw)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const message = raw as Record<string, unknown>
    if (message.type === 'cleanup-error') {
      const error = message.error as { message?: unknown } | undefined
      deps.onCleanupError?.(
        new Error(String(error?.message ?? 'Plugin cleanup failed'))
      )
      return
    }
    if (message.type === 'fatal') {
      fail(new Error('Plugin worker failed'))
      return
    }
    if (!Number.isSafeInteger(message.id)) return
    const id = message.id as number
    if (message.type === 'result') {
      const cancellation = cancelled.get(id)
      if (cancellation !== undefined) {
        clearTimeout(cancellation)
        cancelled.delete(id)
      }
      const task = pending.get(id)
      if (!task) return
      pending.delete(id)
      clearTimeout(task.timer)
      task.removeAbort()
      if (message.error && typeof message.error === 'object') {
        const error = message.error as Record<string, unknown>
        task.reject(
          Object.assign(new Error(String(error.message)), {
            code: error.code,
            messageKey: error.messageKey,
          })
        )
      } else {
        if (task.method === 'init') initialized = true
        task.resolve(message.result)
      }
    } else if (message.type === 'host') {
      const request = pending.get(message.requestId as number)
      const background =
        message.requestId === undefined && initialized && !stopping
      if (
        (!background &&
          (!request || !['init', 'invoke'].includes(request.method))) ||
        typeof message.method !== 'string' ||
        !Array.isArray(message.args)
      ) {
        deps.transport.send({
          type: 'host-result',
          id,
          error: { message: 'Plugin host request is not active' },
        })
        return
      }
      if (
        hostRequests.has(id) ||
        hostRequests.size >= PLUGIN_RPC_LIMITS.pendingRequests
      ) {
        fail(new Error('Too many plugin host requests'))
        return
      }
      hostRequests.set(id, undefined)
      let timer: ReturnType<typeof setTimeout> | undefined
      const work = Promise.resolve().then(() => {
        if (
          closed ||
          (!background && !pending.has(message.requestId as number))
        )
          throw new PluginCancellation('Plugin host request cancelled')
        return deps.callHost(
          message.method as string,
          message.args as unknown[]
        )
      })
      void Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Plugin host request timed out')),
            PLUGIN_RPC_LIMITS.hostTimeoutMs
          )
          hostRequests.set(id, timer)
        }),
      ])
        .then(
          (result) => {
            if (!closed) {
              const response = { type: 'host-result', id, result }
              assertPluginMessage(response)
              deps.transport.send(response)
            }
          },
          (error: unknown) => {
            if (!closed)
              deps.transport.send({
                type: 'host-result',
                id,
                error: { message: errorMessage(error) },
              })
          }
        )
        .catch((error: unknown) =>
          fail(error instanceof Error ? error : new Error(String(error)))
        )
        .finally(() => {
          clearTimeout(timer)
          hostRequests.delete(id)
        })
    }
  })
  /**
   * Nonfatal timeouts cancel one operation. If the worker does not finish
   * within the cancellation grace period, terminate its entire lifetime.
   */
  function request(
    method: PluginRequestMethod,
    args: unknown,
    signal?: AbortSignal,
    timeoutMs = deps.timeoutMs ?? 10000,
    options: { fatalTimeout?: boolean } = {}
  ): Promise<unknown> {
    if (closed || signal?.aborted)
      return Promise.reject(new PluginCancellation('Plugin request cancelled'))
    if (method === 'dispose') stopping = true
    if (pending.size + cancelled.size >= PLUGIN_RPC_LIMITS.pendingRequests)
      return Promise.reject(new Error('Too many plugin requests'))
    try {
      assertPluginMessage(args)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const drop = (error: Error) => {
        const task = pending.get(id)
        if (!task) return
        pending.delete(id)
        clearTimeout(task.timer)
        task.removeAbort()
        cancelled.set(
          id,
          setTimeout(
            () => fail(new Error('Plugin cancellation timed out')),
            deps.cancellationGraceMs ?? PLUGIN_RPC_LIMITS.cancellationGraceMs
          )
        )
        deps.transport.send({ type: 'cancel', id })
        reject(error)
      }
      const abort = () =>
        drop(new PluginCancellation('Plugin request cancelled'))
      const timedOut = new Error(`Plugin ${method} timed out`)
      pending.set(id, {
        resolve,
        reject,
        method,
        timer: setTimeout(
          () =>
            options.fatalTimeout === false ? drop(timedOut) : fail(timedOut),
          timeoutMs
        ),
        removeAbort: () => signal?.removeEventListener('abort', abort),
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        deps.transport.send({ type: 'request', id, method, args })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
  function abortPending() {
    for (const [id, task] of pending) {
      clearTimeout(task.timer)
      task.removeAbort()
      deps.transport.send({ type: 'cancel', id })
      task.reject(new PluginCancellation('Plugin lifetime ended'))
    }
    pending.clear()
    initialized = false
    stopping = true
    deps.transport.send({ type: 'abort' })
  }
  function updateMessages(messages: unknown) {
    if (closed || stopping) return
    try {
      assertPluginMessage(messages)
      deps.transport.send({ type: 'messages', messages })
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return { request, close, abortPending, updateMessages }
}
