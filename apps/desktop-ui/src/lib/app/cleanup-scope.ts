import type { AppEventPayloads, DesktopListen } from '@tyco/shared'

/** Owns synchronous and pending resources for one runtime lifetime. */
export function createCleanupScope() {
  let stopped = false
  const cleanups = [] as (() => void)[]
  const add = (cleanup: () => void) => {
    if (stopped) cleanup()
    else cleanups.push(cleanup)
  }
  const listen = async <K extends keyof AppEventPayloads>(
    subscribe: DesktopListen,
    event: K,
    handler: (payload: AppEventPayloads[K]) => void | Promise<void>
  ) => {
    if (stopped) return
    add(
      await subscribe(event, (payload) => {
        if (!stopped) return handler(payload)
      })
    )
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    const pending = [...cleanups]
    cleanups.length = 0
    for (const cleanup of pending.reverse()) cleanup()
  }
  return {
    add,
    listen,
    stop,
    get stopped() {
      return stopped
    },
  }
}
