import type { DesktopEventPayloads } from '../generated/desktop-types'

export const DESKTOP_EVENTS = {
  QUIT_REQUESTED: 'app://quit-requested',
  QUIT_CANCELLED: 'app://quit-cancelled',
  PLUGINS_CHANGED: 'app://plugins-changed',
  STATE_CHANGED: 'app://state-changed',
  HOTKEYS_CHANGED: 'app://hotkeys-changed',
  OPEN_MAIN_CHAT: 'app://open-main-chat',
  OPEN_MAIN_EDITOR: 'app://open-main-editor',
  /** The user closed the main window rather than hid it */
  MAIN_WINDOW_CLOSED: 'app://main-window-closed',
  ACTIVATION_METRICS_START: 'app://activation-metrics-start',
  ACTIVATION_METRICS_COLLECT: 'app://activation-metrics-collect',
  /** A repeated activation confirms the open voice input; carries its id */
  VOICE_FINISH: 'app://voice-finish',
  VOICE_AUDIO_LEVEL: 'app://voice-audio-level',
  SELECTION_RUN: 'app://selection-run',
  SELECTION_CANCEL: 'app://selection-cancel',
  /** An external call runs a command in the background */
  COMMAND_RUN: 'app://command-run',
  EXTERNAL_JOB_CANCEL: 'app://external-job-cancel',
} as const satisfies Record<string, DesktopEventName>

export type DesktopEventName = keyof DesktopEventPayloads

// every event of the backend has a name here
type MissingEvent = Exclude<
  DesktopEventName,
  (typeof DESKTOP_EVENTS)[keyof typeof DESKTOP_EVENTS]
>
const EVERY_EVENT_NAMED: [MissingEvent] extends [never] ? true : MissingEvent =
  true
void EVERY_EVENT_NAMED

export type DesktopListen = <K extends DesktopEventName>(
  event: K,
  handler: (payload: DesktopEventPayloads[K]) => void | Promise<void>
) => Promise<() => void>
