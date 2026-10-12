import {
  APP_CONFIG,
  parseOpenMainChatEvent,
  type AppEventPayloads,
  DEFAULT_INIT_PARAMS,
  DEFAULT_USER_CONFIG,
  DESKTOP_EVENTS,
  type InitParams,
  type IpcResult,
} from '@tyco/shared'

import { desktopErrorMessage, isDesktopError } from './ipc-error'

export interface DesktopClientDeps {
  isAvailable: () => boolean
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
  listen: <EventName extends keyof AppEventPayloads>(
    event: EventName,
    handler: (payload: AppEventPayloads[EventName]) => void | Promise<void>
  ) => Promise<() => void>
}

export function createDesktopClient(deps: DesktopClientDeps) {
  const localListeners = new Map<string, Set<(payload: unknown) => void>>()

  let localParams: InitParams = structuredClone({
    ...DEFAULT_INIT_PARAMS,
    appConfig: APP_CONFIG,
    userConfig: DEFAULT_USER_CONFIG,
  })

  function emitLocal(event: string, payload: unknown) {
    const listeners = localListeners.get(event)

    if (!listeners) return

    listeners.forEach((listener) => {
      listener(payload)
    })
  }

  /** False in a plain browser, e.g. when the UI is opened from the dev server */
  function isAvailable(): boolean {
    return deps.isAvailable()
  }

  async function invoke<T>(
    command: string,
    args?: Record<string, unknown>
  ): Promise<IpcResult<T>> {
    if (!isAvailable()) {
      return {
        success: false,
        error: `Desktop runtime is not available for command: ${command}`,
      }
    }

    try {
      const result = await deps.invoke<T>(command, args)
      return { success: true, result }
    } catch (error) {
      return {
        success: false,
        error: desktopErrorMessage(error),
        ...(isDesktopError(error) ? { errorCode: error.code } : {}),
      }
    }
  }

  async function listen<EventName extends keyof AppEventPayloads>(
    event: EventName,
    handler: (payload: AppEventPayloads[EventName]) => void | Promise<void>
  ): Promise<() => void> {
    if (isAvailable()) {
      return await deps.listen(event, (payload) => {
        if (event === DESKTOP_EVENTS.OPEN_MAIN_CHAT)
          parseOpenMainChatEvent(payload)
        return handler(payload)
      })
    }

    // without the runtime the events come from `setLocalParams`
    const listeners =
      localListeners.get(event) || new Set<(payload: unknown) => void>()
    listeners.add(handler as (payload: unknown) => void)
    localListeners.set(event, listeners)

    return () => {
      const currentListeners = localListeners.get(event)
      currentListeners?.delete(handler as (payload: unknown) => void)
    }
  }

  function getInitParams(): InitParams {
    return structuredClone(localParams)
  }

  function setLocalParams(nextParams: Partial<InitParams>) {
    localParams = { ...localParams, ...nextParams }

    emitLocal(DESKTOP_EVENTS.PARAMS_CHANGED, getInitParams())
  }

  return { getInitParams, invoke, isAvailable, listen, setLocalParams }
}
