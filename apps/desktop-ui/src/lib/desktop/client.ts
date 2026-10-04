import {
  APP_CONFIG,
  type CommandRunEvent,
  DEFAULT_INIT_PARAMS,
  DEFAULT_USER_CONFIG,
  DESKTOP_EVENTS,
  type InitParams,
  type EditorTransfer,
  type IpcResult,
  type SelectionRunEvent,
} from '@tyco/shared'
import { isTauri, invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

type AppEventPayloads = {
  [DESKTOP_EVENTS.OPEN_MAIN_CHAT]: { text?: string }
  [DESKTOP_EVENTS.PARAMS_CHANGED]: InitParams
  [DESKTOP_EVENTS.OPEN_MAIN_EDITOR]: EditorTransfer
  [DESKTOP_EVENTS.ACTIVATION_METRICS_START]: { id: number }
  [DESKTOP_EVENTS.ACTIVATION_METRICS_COLLECT]: { id: number }
  [DESKTOP_EVENTS.VOICE_AUDIO_LEVEL]: { level: number; peak: number }
  [DESKTOP_EVENTS.SELECTION_RUN]: SelectionRunEvent
  [DESKTOP_EVENTS.SELECTION_CANCEL]: { runId: number }
  [DESKTOP_EVENTS.COMMAND_RUN]: CommandRunEvent
  [DESKTOP_EVENTS.HOTKEYS_CHANGED]: null
  [DESKTOP_EVENTS.MAIN_WINDOW_CLOSED]: null
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

/** False in a plain browser, e.g. when the UI is opened from the dev server */
function isAvailable(): boolean {
  return isTauri()
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
    const result = await tauriInvoke<T>(command, args)
    return { success: true, result }
  } catch (error) {
    // Rust errors arrive as their message string
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

async function listen<EventName extends keyof AppEventPayloads>(
  event: EventName,
  handler: (payload: AppEventPayloads[EventName]) => void
): Promise<() => void> {
  if (isAvailable()) {
    return await tauriListen(event, (eventPayload) => {
      handler(eventPayload.payload as AppEventPayloads[EventName])
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

export const desktopClient = {
  getInitParams,
  invoke,
  isAvailable,
  listen,
  setLocalParams,
}
