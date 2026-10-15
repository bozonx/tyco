import type { SelectionRunEvent } from '../selection'
import type { DesktopSnapshot } from './state'
import type { OpenMainChatEvent } from './chat'
import type { EditorTransfer, CommandRunEvent } from './actions'

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
  VOICE_COMMAND_FINISH: 'app://voice-command-finish',
  VOICE_AUDIO_LEVEL: 'app://voice-audio-level',
  SELECTION_RUN: 'app://selection-run',
  SELECTION_CANCEL: 'app://selection-cancel',
  /** An external call runs a command in the background */
  COMMAND_RUN: 'app://command-run',
  EXTERNAL_JOB_CANCEL: 'app://external-job-cancel',
} as const

/** Serialized payloads shared by every desktop event adapter. */
export interface AppEventPayloads {
  [DESKTOP_EVENTS.QUIT_REQUESTED]: number
  [DESKTOP_EVENTS.QUIT_CANCELLED]: null
  [DESKTOP_EVENTS.PLUGINS_CHANGED]: null
  [DESKTOP_EVENTS.OPEN_MAIN_CHAT]: OpenMainChatEvent
  [DESKTOP_EVENTS.STATE_CHANGED]: DesktopSnapshot
  [DESKTOP_EVENTS.OPEN_MAIN_EDITOR]: EditorTransfer
  [DESKTOP_EVENTS.ACTIVATION_METRICS_START]: { id: number }
  [DESKTOP_EVENTS.ACTIVATION_METRICS_COLLECT]: { id: number }
  [DESKTOP_EVENTS.VOICE_COMMAND_FINISH]: number
  [DESKTOP_EVENTS.VOICE_AUDIO_LEVEL]: { level: number; peak: number }
  [DESKTOP_EVENTS.SELECTION_RUN]: SelectionRunEvent
  [DESKTOP_EVENTS.SELECTION_CANCEL]: { runId: number }
  [DESKTOP_EVENTS.COMMAND_RUN]: CommandRunEvent
  [DESKTOP_EVENTS.EXTERNAL_JOB_CANCEL]: string
  [DESKTOP_EVENTS.HOTKEYS_CHANGED]: null
  [DESKTOP_EVENTS.MAIN_WINDOW_CLOSED]: null
}

export type DesktopListen = <K extends keyof AppEventPayloads>(
  event: K,
  handler: (payload: AppEventPayloads[K]) => void | Promise<void>
) => Promise<() => void>
