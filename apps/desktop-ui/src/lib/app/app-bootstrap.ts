import { DESKTOP_EVENTS, type InitParams } from '@shared'

import { GlobalEvents } from '../../composables/useGlobalEvents'
import { resolveModeRoute, type AppRoutePath } from '../navigation/routes'

export interface AppBootstrapDeps {
  loadInitialParams: () => Promise<InitParams>
  setParams: (params: InitParams) => void
  closeAllModals: () => void
  navigateTo: (path: AppRoutePath) => Promise<void>
  listen: (
    event: string,
    handler: (payload: unknown) => void | Promise<void>
  ) => Promise<() => void>
  emitGlobal: (event: GlobalEvents, payload?: unknown) => void
  initPlugins: () => void
  handleNavKeyUp: (event: KeyboardEvent) => void
  addWindowKeyupListener: (handler: (event: KeyboardEvent) => void) => () => void
}

export function createAppBootstrap(deps: AppBootstrapDeps) {
  let removeParamsListener: (() => void) | undefined
  let removeVoiceListener: (() => void) | undefined
  let removeWindowKeyupListener: (() => void) | undefined
  let lastAppliedMode: InitParams['mode'] | undefined

  const applyParams = async (
    params: InitParams,
    options: { forceNavigate?: boolean } = {}
  ) => {
    deps.setParams(params)
    deps.closeAllModals()

    const shouldNavigate =
      options.forceNavigate || lastAppliedMode === undefined || lastAppliedMode !== params.mode

    lastAppliedMode = params.mode

    if (shouldNavigate) {
      await deps.navigateTo(resolveModeRoute(params.mode))
    }
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    deps.emitGlobal(GlobalEvents.KEY_UP, event)
    deps.handleNavKeyUp(event)
  }

  const start = async () => {
    removeWindowKeyupListener = deps.addWindowKeyupListener(handleKeyUp)
    deps.initPlugins()

    removeParamsListener = await deps.listen(
      DESKTOP_EVENTS.PARAMS_CHANGED,
      async (params) => {
        await applyParams(params as InitParams)
      }
    )

    removeVoiceListener = await deps.listen(
      DESKTOP_EVENTS.VOICE_TEXT,
      (data) => {
        deps.emitGlobal(GlobalEvents.VOICE_RECOGNITION, data)
      }
    )

    const initialParams = await deps.loadInitialParams()
    await applyParams(initialParams, { forceNavigate: true })
    deps.emitGlobal(GlobalEvents.INITED)
  }

  const stop = () => {
    removeWindowKeyupListener?.()
    removeParamsListener?.()
    removeVoiceListener?.()
  }

  return {
    applyParams,
    handleKeyUp,
    start,
    stop,
  }
}
