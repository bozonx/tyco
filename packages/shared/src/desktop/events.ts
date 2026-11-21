import type { DesktopEventPayloads } from '../generated/desktop-types'

export const DESKTOP_EVENTS = {
  QUIT_REQUESTED: 'app://quit-requested',
  QUIT_CANCELLED: 'app://quit-cancelled',
  PLUGINS_CHANGED: 'app://plugins-changed',
  /** Relative paths changed by synchronization, or local vault writes */
  STORAGE_CHANGED: 'app://storage-changed',
  STATE_CHANGED: 'app://state-changed',
  HOTKEYS_CHANGED: 'app://hotkeys-changed',
  OPEN_TRANSFERRED_CHAT: 'app://open-transferred-chat',
  SCREENSHOT_FAILED: 'app://screenshot-failed',
  SCREENSHOT_SELECT_AREA: 'app://screenshot-select-area',
  /** The area selector closed: answered, cancelled or no longer current */
  SCREENSHOT_SELECT_AREA_CLOSED: 'app://screenshot-select-area-closed',
  OPEN_MAIN_CHAT: 'app://open-main-chat',
  OPEN_MAIN_EDITOR: 'app://open-main-editor',
  /** A chat history changed in storage */
  CHATS_CHANGED: 'app://chats-changed',
  /** The editor history changed in storage */
  EDITOR_HISTORY_CHANGED: 'app://editor-history-changed',
  /**
   * A settings save merged a change another device synced into the same fields;
   * the change of this device won
   */
  SETTINGS_CONFLICT: 'app://settings-conflict',
  /** The user closed the main window rather than hid it */
  MAIN_WINDOW_CLOSED: 'app://main-window-closed',
  ACTIVATION_METRICS_START: 'app://activation-metrics-start',
  ACTIVATION_METRICS_COLLECT: 'app://activation-metrics-collect',
  /** A repeated activation confirms the open voice input; carries its id */
  VOICE_FINISH: 'app://voice-finish',
  /** A repeated action-menu activation turns its page */
  ACTION_PAGE_TURN: 'app://action-page-turn',
  /** The held voice hotkey was released; carries the activation id */
  VOICE_RELEASE: 'app://voice-release',
  VOICE_AUDIO_LEVEL: 'app://voice-audio-level',
  SELECTION_RUN: 'app://selection-run',
  SELECTION_CANCEL: 'app://selection-cancel',
  /** A run was refused while another command runs; to the quick window */
  COMMAND_RUN_REJECTED: 'app://command-run-rejected',
  /** Carries the id of the job to stop */
  EXTERNAL_JOB_CANCEL: 'app://external-job-cancel',
  /** End what the window shows before an external request; carries its id */
  END_VISIBLE_WORK: 'app://end-visible-work',
  /** What the subtitles of the dialog show; to the subtitles window */
  SUBTITLES_CHANGED: 'app://subtitles-changed',
  /** A button of the subtitles; to the main window, where the dialog runs */
  SUBTITLES_ACTION_REQUESTED: 'app://subtitles-action-requested',
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
