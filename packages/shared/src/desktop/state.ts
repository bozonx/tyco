import { APP_CONFIG, type AppConfig } from '../app-config'
import { DEFAULT_USER_CONFIG, type UserConfig } from '../user-config'
import type { AccessRequest, LauncherRequest } from './actions'

export enum StartMode {
  SELECT = 'select',
  VOICE = 'voice',
  AI_TASKS = 'aiTasks',
  COMMAND_LAUNCHER = 'commandLauncher',
  CORRECTION = 'correction',
  TRANSLATE = 'translate',
  EDITOR = 'editor',
  WRITE = 'write',
  CHAT = 'chat',
  VOICE_CHAT = 'voiceChat',
  HISTORY = 'history',
  CONFIG = 'config',
  /** Asks whether an external call may use the selection; Tyco opens it itself */
  EXTERNAL_ACCESS = 'externalAccess',
}

export interface SessionState {
  lastChatId?: string | null
  lastMode?: StartMode | null
  /** The model the chat was last used with */
  lastChatModelId?: string | null
  /** Own AI requests typed in the AI task menu, the newest first */
  recentAiPrompts?: string[]
  /** Languages picked from the full list in the translate menu, newest first */
  recentTranslateLanguages?: string[]
}

export const DEFAULT_SESSION_STATE: SessionState = { lastChatId: null }

export interface DesktopActivationState {
  activationId: number
  windowId: string | null
  selectedText: string | null
  mode: StartMode | null
  launcherPage?: number
  launcherRequest?: LauncherRequest | null
  accessRequest?: AccessRequest | null
}

export interface DesktopWindowState {
  isWindowShown: boolean
  windowProfile: 'panel' | 'sheet'
}

export interface DesktopSettingsState {
  userConfig: UserConfig
  sessionState: SessionState
  appConfig: AppConfig
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
  mode: StartMode.EDITOR,
  userConfig: DEFAULT_USER_CONFIG,
  sessionState: DEFAULT_SESSION_STATE,
  appConfig: APP_CONFIG,
  isWindowShown: false,
  windowProfile: 'sheet',
}

/** A coherent backend snapshot; the revision orders every state mutation. */
export interface DesktopSnapshot {
  revision: number
  activation: DesktopActivationState
  window: DesktopWindowState
  settings: DesktopSettingsState
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
    launcherPage,
    launcherRequest,
    accessRequest,
    isWindowShown,
    windowProfile,
    userConfig,
    sessionState,
    appConfig,
  } = view
  return {
    revision,
    activation: {
      activationId,
      windowId,
      selectedText,
      mode,
      launcherPage,
      launcherRequest,
      accessRequest,
    },
    window: { isWindowShown, windowProfile },
    settings: { userConfig, sessionState, appConfig },
  }
}
