import type { DesktopEventPayloads, DesktopListen } from '@tyco/shared'

/** Owns synchronous and pending resources for one runtime lifetime. */
export function createCleanupScope() {
  let stopped = false
  const cleanups = [] as (() => void)[]
  const add = (cleanup: () => void) => {
    if (stopped) cleanup()
    else cleanups.push(cleanup)
  }
  const listen = async <K extends keyof DesktopEventPayloads>(
    subscribe: DesktopListen,
    event: K,
    handler: (payload: DesktopEventPayloads[K]) => void | Promise<void>
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
    get isStopped() {
      return stopped
    },
    get stopped() {
      return stopped
    },
  }
}
