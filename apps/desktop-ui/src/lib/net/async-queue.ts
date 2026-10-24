/** Callback-delivered values read with `for await` */
export interface AsyncQueue<T> {
  push: (value: T) => boolean
  /** Ends normally: what is queued is still delivered */
  end: () => void
  /** Ends early: what is queued is delivered first, then this error */
  fail: (error: Error) => void
  readonly values: AsyncIterable<T>
}

/** What a queue holds unread before it fails, unless told otherwise */
export const DEFAULT_MAX_QUEUED_COUNT = 1024
export const DEFAULT_MAX_QUEUED_BYTES = 1024 * 1024

export function createAsyncQueue<T>(
  options: {
    maxCount?: number
    maxBytes?: number
    sizeOf?: (value: T) => number
    onOverflow?: (error: Error) => void
  } = {}
): AsyncQueue<T> {
  const queue: T[] = []
  let notify: (() => void) | undefined
  let done = false
  let failure: Error | undefined
  let queuedBytes = 0
  const sizeOf = options.sizeOf ?? (() => 1)

  const wake = () => {
    notify?.()
    notify = undefined
  }

  return {
    push(value) {
      if (done) return false
      const size = sizeOf(value)
      if (
        queue.length >= (options.maxCount ?? DEFAULT_MAX_QUEUED_COUNT) ||
        queuedBytes + size > (options.maxBytes ?? DEFAULT_MAX_QUEUED_BYTES)
      ) {
        failure = new Error('Receive queue limit exceeded')
        done = true
        wake()
        options.onOverflow?.(failure)
        return false
      }
      queue.push(value)
      queuedBytes += size
      wake()
      return true
    },
    end() {
      done = true
      wake()
    },
    fail(error) {
      if (done) return
      failure = error
      done = true
      wake()
    },
    values: {
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            if (queue.length > 0) {
              const value = queue.shift() as T
              queuedBytes -= sizeOf(value)
              yield value
              continue
            }
            if (done) {
              if (failure) throw failure
              return
            }
            await new Promise<void>((resolve) => {
              notify = resolve
            })
          }
        } finally {
          done = true
          queue.length = 0
          queuedBytes = 0
          wake()
        }
      },
    },
  }
}
