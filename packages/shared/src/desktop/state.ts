import { DEFAULT_USER_CONFIG } from '../user-config'
import type {
  ActivationMode as ActivationModeName,
  DesktopActivationState,
  DesktopSettingsState,
  DesktopSnapshot,
  DesktopWindowState,
  SessionState,
} from '../generated/desktop-types'

/** What an activation opens */
export type ActivationMode = ActivationModeName

export const ActivationMode = {
  SELECT: 'select',
  VOICE: 'voice',
  AI_TASKS: 'aiTasks',
  VOICE_COMMANDS: 'voiceCommands',
  COMMAND_LAUNCHER: 'commandLauncher',
  CORRECTION: 'correction',
  TRANSLATE: 'translate',
  EDITOR: 'editor',
  WRITE: 'write',
  CHAT: 'chat',
  VOICE_CHAT: 'voiceChat',
  HISTORY: 'history',
  CONFIG: 'config',
  /** Asks whether an external call may use the selection; Tyco opens it itself */
  EXTERNAL_ACCESS: 'externalAccess',
} as const satisfies Record<string, ActivationModeName>

export const DEFAULT_SESSION_STATE: SessionState = {
  lastChatId: null,
  lastMode: null,
  lastChatModelId: null,
  lastProfileChatIds: {},
  recentAiPrompts: [],
  recentTranslateLanguages: [],
}

/** UI projection of the domain snapshot, never serialized as an IPC payload. */
export interface DesktopViewState
  extends DesktopActivationState, DesktopWindowState, DesktopSettingsState {
  revision: number
}

export const DEFAULT_DESKTOP_VIEW_STATE: DesktopViewState = {
  revision: 0,
  activationId: 0,
  windowId: null,
  selectedText: null,
  mode: ActivationMode.EDITOR,
  launcherPageId: null,
  launcherRequest: null,
  accessRequest: null,
  userConfig: DEFAULT_USER_CONFIG,
  sessionState: DEFAULT_SESSION_STATE,
  isWindowShown: false,
  windowProfile: 'sheet',
}

export function desktopSnapshotToView(
  snapshot: DesktopSnapshot
): DesktopViewState {
  return {
    revision: snapshot.revision,
    ...snapshot.activation,
    ...snapshot.window,
    ...snapshot.settings,
  }
}

export function desktopViewToSnapshot(view: DesktopViewState): DesktopSnapshot {
  const {
    revision,
    activationId,
    windowId,
    selectedText,
    mode,
    launcherPageId,
    launcherRequest,
    accessRequest,
    isWindowShown,
    windowProfile,
    userConfig,
    sessionState,
  } = view
  return {
    revision,
    activation: {
      activationId,
      windowId,
      selectedText,
      mode,
      launcherPageId,
      launcherRequest,
      accessRequest,
    },
    window: { isWindowShown, windowProfile },
    settings: { userConfig, sessionState },
  }
}
