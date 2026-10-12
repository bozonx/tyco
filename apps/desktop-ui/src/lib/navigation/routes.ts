import { START_MODES } from '@tyco/shared'

export const APP_ROUTE_NAMES = {
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
  CORRECTION: { name: APP_ROUTE_NAMES.CORRECTION, path: '/correction' },
  TRANSLATE: { name: APP_ROUTE_NAMES.TRANSLATE, path: '/translate' },
} as const

export type AppRoutePath = (typeof APP_ROUTES)[keyof typeof APP_ROUTES]['path']

export const MODE_ROUTE_MAP: Record<START_MODES, AppRoutePath> = {
  [START_MODES.SELECT]: APP_ROUTES.SELECT.path,
  [START_MODES.VOICE]: APP_ROUTES.VOICE.path,
  [START_MODES.AI_TASKS]: APP_ROUTES.AI_TASKS.path,
  [START_MODES.COMMAND_LAUNCHER]: APP_ROUTES.COMMAND_LAUNCHER.path,
  [START_MODES.CORRECTION]: APP_ROUTES.CORRECTION.path,
  [START_MODES.TRANSLATE]: APP_ROUTES.TRANSLATE.path,
  [START_MODES.EDITOR]: APP_ROUTES.EDITOR.path,
  [START_MODES.WRITE]: APP_ROUTES.WRITE.path,
  [START_MODES.CHAT]: APP_ROUTES.CHAT.path,
  [START_MODES.VOICE_CHAT]: APP_ROUTES.CHAT.path,
  [START_MODES.HISTORY]: APP_ROUTES.HISTORY.path,
  [START_MODES.CONFIG]: APP_ROUTES.CONFIG.path,
  // the quick window renders it by the mode, see `QuickOverlay`
  [START_MODES.EXTERNAL_ACCESS]: APP_ROUTES.HOME.path,
}

/**
 * Modes shown by the quick window; the rest belong to the main window. Keep in
 * sync with `window_label_for_mode` in `src-tauri/src/services/runtime.rs`.
 */
export const QUICK_WINDOW_MODES: ReadonlySet<START_MODES> = new Set([
  START_MODES.WRITE,
  START_MODES.VOICE,
  START_MODES.SELECT,
  START_MODES.AI_TASKS,
  START_MODES.COMMAND_LAUNCHER,
  START_MODES.CORRECTION,
  START_MODES.VOICE_CHAT,
  START_MODES.TRANSLATE,
  START_MODES.EXTERNAL_ACCESS,
])

export function isQuickWindowMode(mode: START_MODES | null): boolean {
  return mode !== null && QUICK_WINDOW_MODES.has(mode)
}

export function resolveModeRoute(mode: START_MODES | null): AppRoutePath {
  return mode ? MODE_ROUTE_MAP[mode] : APP_ROUTES.HOME.path
}
