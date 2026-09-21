/** Callback-delivered values read with `for await` */
export interface AsyncQueue<T> {
  push: (value: T) => void
  /** Ends normally: what is queued is still delivered */
  end: () => void
  /** Ends early: what is queued is delivered first, then this error */
  fail: (error: Error) => void
  readonly values: AsyncIterable<T>
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const queue: T[] = []
  let notify: (() => void) | undefined
  let done = false
  let failure: Error | undefined

  const wake = () => {
    notify?.()
    notify = undefined
  }

  return {
    push(value) {
      if (done) return
      queue.push(value)
      wake()
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
        for (;;) {
          if (queue.length > 0) {
            yield queue.shift() as T
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
      },
    },
  }
}
