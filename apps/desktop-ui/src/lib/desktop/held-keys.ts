export interface KeyEventSource {
  addEventListener: (
    type: 'keydown' | 'keyup' | 'blur',
    listener: (event: Event) => void,
    capture?: boolean
  ) => void
}

/**
 * Tracks the keys held down in this window. Text insertion presses the paste
 * keys in another window, where modifiers still held by the user (e.g. the
 * Shift of a Shift+Enter shortcut) would join them.
 */
export function createHeldKeys(source: KeyEventSource) {
  const held = new Set<string>()
  const waiters = new Set<() => void>()

  const settle = () => {
    if (held.size > 0) return
    for (const resolve of [...waiters]) resolve()
  }
  const keyOf = (event: Event) => {
    const { code, key } = event as KeyboardEvent
    return code || key
  }

  source.addEventListener('keydown', (event) => held.add(keyOf(event)), true)
  source.addEventListener(
    'keyup',
    (event) => {
      held.delete(keyOf(event))
      settle()
    },
    true
  )
  // key releases outside the window never arrive
  source.addEventListener('blur', () => {
    held.clear()
    settle()
  })

  /** Resolves once no key is held, or after `timeoutMs` for a lost release. */
  function waitForRelease(timeoutMs: number): Promise<void> {
    if (held.size === 0) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      waiters.add(done)
    })
  }

  return { waitForRelease }
}
