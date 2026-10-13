import { StartMode } from '@tyco/shared'

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

export const MODE_ROUTE_MAP: Record<StartMode, AppRoutePath> = {
  [StartMode.SELECT]: APP_ROUTES.SELECT.path,
  [StartMode.VOICE]: APP_ROUTES.VOICE.path,
  [StartMode.AI_TASKS]: APP_ROUTES.AI_TASKS.path,
  [StartMode.COMMAND_LAUNCHER]: APP_ROUTES.COMMAND_LAUNCHER.path,
  [StartMode.CORRECTION]: APP_ROUTES.CORRECTION.path,
  [StartMode.TRANSLATE]: APP_ROUTES.TRANSLATE.path,
  [StartMode.EDITOR]: APP_ROUTES.EDITOR.path,
  [StartMode.WRITE]: APP_ROUTES.WRITE.path,
  [StartMode.CHAT]: APP_ROUTES.CHAT.path,
  [StartMode.VOICE_CHAT]: APP_ROUTES.CHAT.path,
  [StartMode.HISTORY]: APP_ROUTES.HISTORY.path,
  [StartMode.CONFIG]: APP_ROUTES.CONFIG.path,
  // the quick window renders it by the mode, see `QuickOverlay`
  [StartMode.EXTERNAL_ACCESS]: APP_ROUTES.HOME.path,
}

/**
 * Modes shown by the quick window; the rest belong to the main window. Keep in
 * sync with `window_label_for_mode` in `src-tauri/src/services/runtime.rs`.
 */
export const QUICK_WINDOW_MODES: ReadonlySet<StartMode> = new Set([
  StartMode.WRITE,
  StartMode.VOICE,
  StartMode.SELECT,
  StartMode.AI_TASKS,
  StartMode.COMMAND_LAUNCHER,
  StartMode.CORRECTION,
  StartMode.VOICE_CHAT,
  StartMode.TRANSLATE,
  StartMode.EXTERNAL_ACCESS,
])

export function isQuickWindowMode(mode: StartMode | null): boolean {
  return mode !== null && QUICK_WINDOW_MODES.has(mode)
}

export function resolveModeRoute(mode: StartMode | null): AppRoutePath {
  return mode ? MODE_ROUTE_MAP[mode] : APP_ROUTES.HOME.path
}
