import { PluginCancellation } from '@tyco/plugin-sdk'

export interface PluginTransport {
  send(message: unknown): void
  listen(handler: (message: unknown) => void): () => void
  close(): void
}
interface Request {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  removeAbort(): void
  method: string
}
export interface PluginRpcDependencies {
  transport: PluginTransport
  callHost(method: string, args: unknown[]): Promise<unknown>
  onFailure(error: Error): void
  timeoutMs?: number
}

/** Owns one isolated channel. No peer can choose a different plugin identity. */
export function createPluginRpc(deps: PluginRpcDependencies) {
  let sequence = 0
  let closed = false
  const pending = new Map<number, Request>()
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
  }
  function fail(error: Error) {
    close(error)
    deps.onFailure(error)
  }
  const removeListener = deps.transport.listen((raw) => {
    if (closed || !raw || typeof raw !== 'object') return
    const message = raw as Record<string, unknown>
    if (message.type === 'fatal') {
      fail(new Error('Plugin worker failed'))
      return
    }
    if (!Number.isSafeInteger(message.id)) return
    const id = message.id as number
    if (message.type === 'result') {
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
      } else task.resolve(message.result)
    } else if (message.type === 'host') {
      const request = pending.get(message.requestId as number)
      if (
        !request ||
        !['init', 'invoke', 'dispose'].includes(request.method) ||
        typeof message.method !== 'string' ||
        !Array.isArray(message.args)
      )
        return
      void deps.callHost(message.method, message.args).then(
        (result) => {
          if (!closed) deps.transport.send({ type: 'host-result', id, result })
        },
        (error: unknown) => {
          if (!closed)
            deps.transport.send({
              type: 'host-result',
              id,
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            })
        }
      )
    }
  })
  function request(
    method: string,
    args: unknown,
    signal?: AbortSignal,
    timeoutMs = deps.timeoutMs ?? 10000
  ): Promise<unknown> {
    if (closed || signal?.aborted)
      return Promise.reject(new PluginCancellation('Plugin request cancelled'))
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const abort = () => {
        const task = pending.get(id)
        if (!task) return
        pending.delete(id)
        clearTimeout(task.timer)
        task.removeAbort()
        deps.transport.send({ type: 'cancel', id })
        reject(new PluginCancellation('Plugin request cancelled'))
      }
      pending.set(id, {
        resolve,
        reject,
        method,
        timer: setTimeout(
          () => fail(new Error(`Plugin ${method} timed out`)),
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
    deps.transport.send({ type: 'abort' })
  }
  return { request, close, abortPending }
}
