import type { DesktopViewState } from '@tyco/shared'

/**
 * @deprecated Mount the real stores over `installFakeDesktop()` instead; see
 *   `dev_docs/testing.md`. Kept until the older tests are migrated.
 *
 *   A stand-in for `useDesktopStore` over the state the test owns: the state is
 *   read on every access, so a test may swap or mutate it
 */
export function mockDesktopStore<T extends object>(
  getState: () => object,
  methods: T = {} as T
) {
  // tests give only the fields the code under test reads
  const state = () => getState() as DesktopViewState
  return {
    get desktopState() {
      return state()
    },
    get userConfig() {
      return state().userConfig
    },
    get sessionState() {
      return state().sessionState
    },
    get canInsertIntoWindow() {
      const current = state() as {
        canInsertIntoWindow?: boolean
        windowId?: unknown
      }
      return current.canInsertIntoWindow ?? Boolean(current.windowId)
    },
    ...methods,
  }
}
