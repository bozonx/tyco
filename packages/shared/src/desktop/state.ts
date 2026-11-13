import { DEFAULT_USER_CONFIG } from '../user-config'
import type {
  ActivationMode as ActivationModeName,
  DesktopActivationState,
  DesktopSettingsState,
  DesktopSnapshot,
  DesktopWindowState,
  SessionState,
  UserDataState,
} from '../generated/desktop-types'

/** What an activation opens */
export type ActivationMode = ActivationModeName

export const ActivationMode = {
  SELECTION_ACTIONS: 'selectionActions',
  VOICE: 'voice',
  LISTEN: 'listen',
  VOICE_COMMANDS: 'voiceCommands',
  CORRECTION: 'correction',
  TRANSLATION: 'translation',
  STYLING: 'styling',
  TRANSFORMATION: 'transformation',
  QUICK_AI_REQUEST: 'quickAiRequest',
  VOICE_QUICK_AI_REQUEST: 'voiceQuickAiRequest',
  SCREENSHOT_QUICK_AI_REQUEST: 'screenshotQuickAiRequest',
  VOICE_SCREENSHOT_QUICK_AI_REQUEST: 'voiceScreenshotQuickAiRequest',
  CHAT_PROMPTS: 'chatPrompts',
  FAVORITES: 'favorites',
  EDITOR: 'editor',
  QUICK_INPUT: 'quickInput',
  CHAT: 'chat',
  HISTORY: 'history',
  CONFIG: 'config',
  /** Asks whether an external call may use the selection; Tyco opens it itself */
  EXTERNAL_ACCESS: 'externalAccess',
  CUSTOM_ACTION: 'customAction',
} as const satisfies Record<string, ActivationModeName>

/** The user data folder before the backend tells where it is */
export const DEFAULT_USER_DATA_STATE: UserDataState = {
  path: '',
  defaultPath: '',
  isDefault: true,
  status: 'connected',
  isWritableByOthers: false,
  deviceId: '',
  platform: 'linux',
}

export const DEFAULT_SESSION_STATE: SessionState = {
  lastChatId: null,
  lastMode: null,
  lastProfileChatIds: {},
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
  actionPageIndex: null,
  customActionIndex: null,
  historyOrigin: null,
  settingsTab: null,
  accessRequest: null,
  userConfig: DEFAULT_USER_CONFIG,
  sessionState: DEFAULT_SESSION_STATE,
  userData: DEFAULT_USER_DATA_STATE,
  isWindowShown: false,
  windowProfile: 'sheet',
  canMoveOverlay: false,
  canListen: false,
  canListenToApps: false,
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
    quickInputText,
    screenshot,
    mode,
    actionPageIndex,
    customActionIndex,
    historyOrigin,
    settingsTab,
    accessRequest,
    isWindowShown,
    windowProfile,
    canMoveOverlay,
    canListen,
    canListenToApps,
    userConfig,
    sessionState,
    userData,
  } = view
  return {
    revision,
    activation: {
      activationId,
      windowId,
      selectedText,
      ...(quickInputText !== undefined ? { quickInputText } : {}),
      ...(screenshot ? { screenshot } : {}),
      mode,
      actionPageIndex,
      customActionIndex,
      historyOrigin,
      settingsTab,
      accessRequest,
    },
    window: {
      isWindowShown,
      windowProfile,
      canMoveOverlay,
      canListen,
      canListenToApps,
    },
    settings: { userConfig, sessionState, userData },
  }
}
