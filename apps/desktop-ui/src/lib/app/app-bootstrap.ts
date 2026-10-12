import {
  DESKTOP_EVENTS,
  type DesktopListen,
  type InitParams,
} from '@tyco/shared'

import { createCleanupScope } from './cleanup-scope'

import { GlobalEvents } from './global-events'
import { resolveModeRoute, type AppRoutePath } from '../navigation/routes'

export interface AppBootstrapDeps {
  loadInitialParams: () => Promise<InitParams>
  setParams: (params: Partial<InitParams>) => void
  closeAllModals: () => void
  navigateTo: (path: AppRoutePath) => Promise<void>
  /**
   * Whether this window shows the mode. Both windows get every activation, and
   * a screen opened for the other window's mode would run there unseen: a
   * dictation would take the microphone from the window the user looks at
   */
  ownsMode?: (mode: InitParams['mode']) => boolean
  listen: DesktopListen
  emitGlobal: (event: GlobalEvents, payload?: unknown) => void
  initPlugins: () => void | Promise<void>
  handleNavKeyUp: (event: KeyboardEvent) => void
  addWindowKeyupListener: (
    handler: (event: KeyboardEvent) => void
  ) => () => void
}

export function createAppBootstrap(deps: AppBootstrapDeps) {
  let scope: ReturnType<typeof createCleanupScope> | undefined
  let starting: Promise<void> | undefined
  let lastAppliedMode: InitParams['mode'] | undefined

  const applyParams = async (
    params: InitParams,
    options: { forceNavigate?: boolean } = {}
  ) => {
    deps.setParams(params)

    if (deps.ownsMode && !deps.ownsMode(params.mode)) {
      // the screen stays as it was; at start there is none yet
      if (lastAppliedMode === undefined) {
        lastAppliedMode = null
        await deps.navigateTo(resolveModeRoute(null))
      }
      return
    }

    const shouldNavigate =
      options.forceNavigate ||
      lastAppliedMode === undefined ||
      lastAppliedMode !== params.mode

    lastAppliedMode = params.mode

    if (shouldNavigate) {
      deps.closeAllModals()
      await deps.navigateTo(resolveModeRoute(params.mode))
    }
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    deps.emitGlobal(GlobalEvents.KEY_UP, event)
    deps.handleNavKeyUp(event)
  }

  const start = (): Promise<void> => {
    if (starting) return starting
    if (scope && !scope.stopped) return Promise.resolve()
    const run = createCleanupScope()
    scope = run
    lastAppliedMode = undefined
    const work = async () => {
      try {
        run.add(deps.addWindowKeyupListener(handleKeyUp))
        await run.listen(
          deps.listen,
          DESKTOP_EVENTS.PARAMS_CHANGED,
          async (params) => {
            await applyParams(params)
          }
        )
        if (run.stopped) return
        await run.listen(
          deps.listen,
          DESKTOP_EVENTS.CONTEXT_CAPTURED,
          (context) => {
            deps.setParams(context)
          }
        )
        if (run.stopped) return
        const initialParams = await deps.loadInitialParams()
        if (run.stopped) return
        await applyParams(initialParams, { forceNavigate: true })
        if (run.stopped) return
        await deps.initPlugins()
        if (!run.stopped) deps.emitGlobal(GlobalEvents.INITED)
      } catch (error) {
        run.stop()
        throw error
      }
    }
    starting = work().finally(() => {
      starting = undefined
    })
    return starting
  }

  const stop = () => scope?.stop()

  return { applyParams, handleKeyUp, start, stop }
}
