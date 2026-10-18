import type { DesktopViewState } from '@tyco/shared'

/**
 * A stand-in for `useDesktopStore` over the state the test owns: the state is
 * read on every access, so a test may swap or mutate it
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
    get appConfig() {
      return state().appConfig
    },
    get sessionState() {
      return state().sessionState
    },
    ...methods,
  }
}
