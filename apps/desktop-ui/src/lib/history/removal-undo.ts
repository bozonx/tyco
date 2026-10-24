import { shallowRef } from 'vue'

/** How long a removed item can be restored, unless told otherwise */
const DEFAULT_UNDO_TIMEOUT_MS = 8000

export interface RemovalUndoDependencies<T> {
  remove: (id: string) => Promise<T | null>
  restore: (item: T) => Promise<void>
  release?: (item: T) => Promise<void>
  clear?: () => Promise<void>
  reportError: (error: unknown) => void
  timeoutMs?: number
}

/** Serializes mutations and retains the removed item until restoration succeeds. */
export function createRemovalUndo<T>(deps: RemovalUndoDependencies<T>) {
  const removed = shallowRef<T | null>(null)
  let queue = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const stopTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const release = async (item: T | null) => {
    if (item === null) return
    try {
      await deps.release?.(item)
    } catch (error) {
      deps.reportError(error)
    }
  }
  const discard = async () => {
    stopTimer()
    const item = removed.value
    removed.value = null
    await release(item)
  }
  const enqueue = (operation: () => Promise<void>) => {
    queue = queue.then(operation).catch(deps.reportError)
    return queue
  }
  const expire = () => {
    stopTimer()
    if (disposed || removed.value === null) return
    timer = setTimeout(() => {
      void enqueue(discard)
    }, deps.timeoutMs ?? DEFAULT_UNDO_TIMEOUT_MS)
  }

  return {
    removed,
    remove: (id: string) =>
      enqueue(async () => {
        if (disposed) return
        stopTimer()
        try {
          const item = await deps.remove(id)
          if (item === null) return
          await discard()
          if (disposed) await release(item)
          else removed.value = item
        } finally {
          expire()
        }
      }),
    undo: () =>
      enqueue(async () => {
        if (disposed || removed.value === null) return
        stopTimer()
        const item = removed.value
        try {
          await deps.restore(item)
          await discard()
        } finally {
          expire()
        }
      }),
    clear: () =>
      enqueue(async () => {
        if (disposed || !deps.clear) return
        stopTimer()
        try {
          await deps.clear()
          await discard()
        } finally {
          expire()
        }
      }),
    dispose: () => {
      disposed = true
      stopTimer()
      return enqueue(discard)
    },
  }
}
