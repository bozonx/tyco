import {
  APP_CONFIG,
  DEFAULT_INIT_PARAMS,
  DEFAULT_USER_CONFIG,
  DESKTOP_EVENTS,
  type InitParams,
  type IpcResult,
} from '@shared'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

type AppEventPayloads = {
  [DESKTOP_EVENTS.PARAMS_CHANGED]: InitParams
  [DESKTOP_EVENTS.VOICE_TEXT]: string
}

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

async function invoke<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<IpcResult<T>> {
  try {
    const result = await tauriInvoke<T>(command, args)
    return { success: true, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('window is not defined')
      || message.includes('Cannot read properties of undefined')
    ) {
      return {
        success: false,
        error: `Desktop runtime is not available for command: ${command}`,
      }
    }

    return {
      success: false,
      error: message,
    }
  }
}

async function listen<EventName extends keyof AppEventPayloads>(
  event: EventName,
  handler: (payload: AppEventPayloads[EventName]) => void
): Promise<() => void> {
  try {
    return tauriListen(event, (eventPayload) => {
      handler(eventPayload.payload as AppEventPayloads[EventName])
    })
  } catch (_error) {
    const listeners = localListeners.get(event) || new Set<(payload: unknown) => void>()
    listeners.add(handler as (payload: unknown) => void)
    localListeners.set(event, listeners)

    return () => {
      const currentListeners = localListeners.get(event)
      currentListeners?.delete(handler as (payload: unknown) => void)
    }
  }
}

function getInitParams(): InitParams {
  return structuredClone(localParams)
}

function setLocalParams(nextParams: Partial<InitParams>) {
  localParams = {
    ...localParams,
    ...nextParams,
  }

  emitLocal(DESKTOP_EVENTS.PARAMS_CHANGED, getInitParams())
}

export const desktopClient = {
  getInitParams,
  invoke,
  listen,
  setLocalParams,
}
