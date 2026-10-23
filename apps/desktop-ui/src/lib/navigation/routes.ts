import { ActivationMode } from '@tyco/shared'

const APP_ROUTE_NAMES = {
  HOME: 'home',
  EDITOR: 'editor',
  HISTORY: 'history',
  CONFIG: 'config',
  CHAT: 'chat',
  WRITE: 'write',
  VOICE: 'voice',
  AI_TASKS: 'aiTasks',
  SELECT: 'select',
  COMMAND_LAUNCHER: 'commandLauncher',
  VOICE_COMMANDS: 'voiceCommands',
  CORRECTION: 'correction',
  TRANSLATE: 'translate',
} as const

export const APP_ROUTES = {
  HOME: { name: APP_ROUTE_NAMES.HOME, path: '/' },
  EDITOR: { name: APP_ROUTE_NAMES.EDITOR, path: '/editor' },
  HISTORY: { name: APP_ROUTE_NAMES.HISTORY, path: '/history' },
  CONFIG: { name: APP_ROUTE_NAMES.CONFIG, path: '/config' },
  CHAT: { name: APP_ROUTE_NAMES.CHAT, path: '/chat' },
  WRITE: { name: APP_ROUTE_NAMES.WRITE, path: '/write' },
  VOICE: { name: APP_ROUTE_NAMES.VOICE, path: '/voice' },
  AI_TASKS: { name: APP_ROUTE_NAMES.AI_TASKS, path: '/aiTasks' },
  SELECT: { name: APP_ROUTE_NAMES.SELECT, path: '/select' },
  COMMAND_LAUNCHER: {
    name: APP_ROUTE_NAMES.COMMAND_LAUNCHER,
    path: '/commandLauncher',
  },
  VOICE_COMMANDS: {
    name: APP_ROUTE_NAMES.VOICE_COMMANDS,
    path: '/voiceCommands',
  },
  CORRECTION: { name: APP_ROUTE_NAMES.CORRECTION, path: '/correction' },
  TRANSLATE: { name: APP_ROUTE_NAMES.TRANSLATE, path: '/translate' },
} as const

export type AppRoutePath = (typeof APP_ROUTES)[keyof typeof APP_ROUTES]['path']

export const MODE_ROUTE_MAP: Record<ActivationMode, AppRoutePath> = {
  [ActivationMode.SELECTION_ACTIONS]: APP_ROUTES.SELECT.path,
  [ActivationMode.VOICE]: APP_ROUTES.VOICE.path,
  [ActivationMode.AI_TASKS]: APP_ROUTES.AI_TASKS.path,
  [ActivationMode.VOICE_COMMANDS]: APP_ROUTES.VOICE_COMMANDS.path,
  [ActivationMode.COMMAND_LAUNCHER]: APP_ROUTES.COMMAND_LAUNCHER.path,
  [ActivationMode.CORRECTION]: APP_ROUTES.CORRECTION.path,
  [ActivationMode.TRANSLATION]: APP_ROUTES.TRANSLATE.path,
  [ActivationMode.EDITOR]: APP_ROUTES.EDITOR.path,
  [ActivationMode.QUICK_INPUT]: APP_ROUTES.WRITE.path,
  [ActivationMode.CHAT]: APP_ROUTES.CHAT.path,
  [ActivationMode.VOICE_CHAT]: APP_ROUTES.CHAT.path,
  [ActivationMode.HISTORY]: APP_ROUTES.HISTORY.path,
  [ActivationMode.CONFIG]: APP_ROUTES.CONFIG.path,
  // the quick window renders it by the mode, see `QuickOverlay`
  [ActivationMode.EXTERNAL_ACCESS]: APP_ROUTES.HOME.path,
}

/**
 * Modes shown by the quick window; the rest belong to the main window. Keep in
 * sync with `window_label_for_mode` in `src-tauri/src/services/runtime.rs`.
 */
const QUICK_WINDOW_MODES: ReadonlySet<ActivationMode> = new Set([
  ActivationMode.QUICK_INPUT,
  ActivationMode.VOICE,
  ActivationMode.SELECTION_ACTIONS,
  ActivationMode.AI_TASKS,
  ActivationMode.VOICE_COMMANDS,
  ActivationMode.COMMAND_LAUNCHER,
  ActivationMode.CORRECTION,
  ActivationMode.VOICE_CHAT,
  ActivationMode.TRANSLATION,
  ActivationMode.EXTERNAL_ACCESS,
])

export function isQuickWindowMode(mode: ActivationMode | null): boolean {
  return mode !== null && QUICK_WINDOW_MODES.has(mode)
}

export function resolveModeRoute(mode: ActivationMode | null): AppRoutePath {
  return mode ? MODE_ROUTE_MAP[mode] : APP_ROUTES.HOME.path
}
