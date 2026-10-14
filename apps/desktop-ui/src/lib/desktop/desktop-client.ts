import {
  APP_CONFIG,
  desktopViewToSnapshot,
  parseOpenMainChatEvent,
  type AppEventPayloads,
  DEFAULT_DESKTOP_VIEW_STATE,
  DEFAULT_USER_CONFIG,
  DESKTOP_EVENTS,
  type DesktopViewState,
  type DesktopInvoke,
  type DesktopCommandName,
  type DesktopCommandResult,
  type DesktopInvokeArgs,
  type IpcResult,
} from '@tyco/shared'

import { desktopErrorMessage, isDesktopError } from './ipc-error'

export interface DesktopClientDependencies {
  onEventError: (event: string, error: unknown) => void
  isAvailable: () => boolean
  invoke: DesktopInvoke
  listen: <EventName extends keyof AppEventPayloads>(
    event: EventName,
    handler: (payload: AppEventPayloads[EventName]) => void | Promise<void>
  ) => Promise<() => void>
}

export function createDesktopClient(deps: DesktopClientDependencies) {
  const localListeners = new Map<string, Set<(payload: unknown) => void>>()

  let localParams: DesktopViewState = structuredClone({
    ...DEFAULT_DESKTOP_VIEW_STATE,
    appConfig: APP_CONFIG,
    userConfig: DEFAULT_USER_CONFIG,
  })

  function reportEventError(event: string, error: unknown) {
    deps.onEventError(event, error)
  }

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

  async function invoke<K extends DesktopCommandName>(
    command: K,
    ...args: DesktopInvokeArgs<K>
  ): Promise<IpcResult<DesktopCommandResult<K>>> {
    if (!isAvailable())
      return {
        success: false,
        error: `Desktop runtime is not available for command: ${command}`,
      }
    try {
      const result = await deps.invoke(command, ...args)
      return { success: true, result } as IpcResult<DesktopCommandResult<K>>
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
    const deliver = (payload: AppEventPayloads[EventName]) => {
      try {
        if (event === DESKTOP_EVENTS.OPEN_MAIN_CHAT)
          parseOpenMainChatEvent(payload)
        Promise.resolve(handler(payload)).catch((error) =>
          reportEventError(event, error)
        )
      } catch (error) {
        reportEventError(event, error)
      }
    }
    if (isAvailable()) return await deps.listen(event, deliver)

    // without the runtime the events come from `setLocalParams`
    const listeners =
      localListeners.get(event) || new Set<(payload: unknown) => void>()
    listeners.add(deliver as (payload: unknown) => void)
    localListeners.set(event, listeners)

    return () => {
      const currentListeners = localListeners.get(event)
      currentListeners?.delete(deliver as (payload: unknown) => void)
    }
  }

  function getDesktopViewState(): DesktopViewState {
    return structuredClone(localParams)
  }

  function setLocalParams(nextParams: Partial<DesktopViewState>) {
    localParams = {
      ...localParams,
      ...nextParams,
      revision: localParams.revision + 1,
    }

    emitLocal(
      DESKTOP_EVENTS.STATE_CHANGED,
      desktopViewToSnapshot(getDesktopViewState())
    )
  }

  return { getDesktopViewState, invoke, isAvailable, listen, setLocalParams }
}
