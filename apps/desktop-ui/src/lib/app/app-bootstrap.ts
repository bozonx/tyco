import {
  DESKTOP_EVENTS,
  type CapturedContext,
  type InitParams,
} from '@tyco/shared'

import { GlobalEvents } from '../../composables/useGlobalEvents'
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
  listen: (
    event: string,
    handler: (payload: unknown) => void | Promise<void>
  ) => Promise<() => void>
  emitGlobal: (event: GlobalEvents, payload?: unknown) => void
  initPlugins: () => void | Promise<void>
  handleNavKeyUp: (event: KeyboardEvent) => void
  addWindowKeyupListener: (
    handler: (event: KeyboardEvent) => void
  ) => () => void
}

export function createAppBootstrap(deps: AppBootstrapDeps) {
  let removeParamsListener: (() => void) | undefined
  let removeContextListener: (() => void) | undefined
  let removeWindowKeyupListener: (() => void) | undefined
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

  const start = async () => {
    removeWindowKeyupListener = deps.addWindowKeyupListener(handleKeyUp)

    removeParamsListener = await deps.listen(
      DESKTOP_EVENTS.PARAMS_CHANGED,
      async (params) => {
        await applyParams(params as InitParams)
      }
    )

    removeContextListener = await deps.listen(
      DESKTOP_EVENTS.CONTEXT_CAPTURED,
      (context) => {
        deps.setParams(context as CapturedContext)
      }
    )

    const initialParams = await deps.loadInitialParams()
    await applyParams(initialParams, { forceNavigate: true })
    await deps.initPlugins()
    deps.emitGlobal(GlobalEvents.INITED)
  }

  const stop = () => {
    removeWindowKeyupListener?.()
    removeParamsListener?.()
    removeContextListener?.()
  }

  return { applyParams, handleKeyUp, start, stop }
}
