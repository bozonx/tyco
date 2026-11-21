/** How long a window waits for its work to end before it answers anyway */
export const VISIBLE_WORK_TIMEOUT_MS = 2500

export interface VisibleWorkDependencies {
  /** Tells the backend the window is done with request `requestId` */
  answer: (requestId: number) => Promise<void>
  reportError?: (error: unknown) => void
  timeoutMs?: number
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

/** Ends one kind of visible work, e.g. a dictation; resolves when it is saved */
export type VisibleWorkEnder = () => Promise<void> | void

/**
 * What a window shows that an external request must end first: a dictation or
 * the dialog stop recording and save their result to the history, a command run
 * is cancelled. The backend waits for every window's answer, bounded
 */
export function createVisibleWork(deps: VisibleWorkDependencies) {
  const enders = new Set<VisibleWorkEnder>()
  const timeoutMs = deps.timeoutMs ?? VISIBLE_WORK_TIMEOUT_MS
  const startTimer =
    deps.setTimeout ??
    ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms))
  const stopTimer =
    deps.clearTimeout ??
    ((handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))

  /** Adds an ender; returns its removal */
  const register = (ender: VisibleWorkEnder) => {
    enders.add(ender)
    return () => {
      enders.delete(ender)
    }
  }

  /** Ends everything registered, then answers the request */
  const end = async (requestId: number) => {
    const all = Promise.all(
      [...enders].map((ender) =>
        Promise.resolve()
          .then(ender)
          .catch((error: unknown) => deps.reportError?.(error))
      )
    ).then(() => undefined)
    let timer: unknown
    const timeout = new Promise<void>((resolve) => {
      timer = startTimer(resolve, timeoutMs)
    })
    await Promise.race([all, timeout])
    stopTimer(timer)
    await deps.answer(requestId).catch((error: unknown) => {
      deps.reportError?.(error)
    })
  }

  return { register, end }
}
