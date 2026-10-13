import type { LiveDictation } from './live-dictation'

/** Each mounted input owns a lease; late cleanup cannot stop another input. */
export function createDictationOwnership(dictation: LiveDictation) {
  let desiredOwner: symbol | undefined
  let captureOwner: symbol | undefined
  let operation = Promise.resolve()

  function enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = operation.then(run)
    operation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function createSession(): LiveDictation {
    const owner = Symbol('dictation-owner')
    return {
      start(request) {
        desiredOwner = owner
        return enqueue(async () => {
          if (desiredOwner !== owner) return
          if (captureOwner !== undefined) await dictation.cancel()
          captureOwner = owner
          try {
            await dictation.start(request)
          } catch (error) {
            if (captureOwner === owner) captureOwner = undefined
            throw error
          }
        })
      },
      finish() {
        return enqueue(async () => {
          if (captureOwner !== owner || desiredOwner !== owner) return ''
          return dictation.finish()
        })
      },
      cancel() {
        if (desiredOwner === owner) desiredOwner = undefined
        return enqueue(async () => {
          if (captureOwner !== owner) return
          await dictation.cancel()
          captureOwner = undefined
        })
      },
    }
  }

  return { createSession }
}
