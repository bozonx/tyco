import { ActivationMode } from '@tyco/shared'

const APP_ROUTE_NAMES = {
  HOME: 'home',
  EDITOR: 'editor',
  HISTORY: 'history',
  CONFIG: 'config',
  CHAT: 'chat',
  WRITE: 'write',
  VOICE: 'voice',
  SELECT: 'select',
  VOICE_COMMANDS: 'voiceCommands',
  CORRECTION: 'correction',
  TRANSLATE: 'translate',
  STYLING: 'styling',
  TRANSFORMATION: 'transformation',
  CUSTOM_TRANSFORMATION: 'customTransformation',
  VOICE_TRANSFORMATION: 'voiceTransformation',
  CHAT_PROMPTS: 'chatPrompts',
  SNIPPETS: 'snippets',
} as const

export const APP_ROUTES = {
  HOME: { name: APP_ROUTE_NAMES.HOME, path: '/' },
  EDITOR: { name: APP_ROUTE_NAMES.EDITOR, path: '/editor' },
  HISTORY: { name: APP_ROUTE_NAMES.HISTORY, path: '/history' },
  CONFIG: { name: APP_ROUTE_NAMES.CONFIG, path: '/config' },
  CHAT: { name: APP_ROUTE_NAMES.CHAT, path: '/chat' },
  WRITE: { name: APP_ROUTE_NAMES.WRITE, path: '/write' },
  VOICE: { name: APP_ROUTE_NAMES.VOICE, path: '/voice' },
  SELECT: { name: APP_ROUTE_NAMES.SELECT, path: '/select' },
  VOICE_COMMANDS: {
    name: APP_ROUTE_NAMES.VOICE_COMMANDS,
    path: '/voiceCommands',
  },
  CORRECTION: { name: APP_ROUTE_NAMES.CORRECTION, path: '/correction' },
  TRANSLATE: { name: APP_ROUTE_NAMES.TRANSLATE, path: '/translate' },
  STYLING: { name: APP_ROUTE_NAMES.STYLING, path: '/styling' },
  TRANSFORMATION: {
    name: APP_ROUTE_NAMES.TRANSFORMATION,
    path: '/transformation',
  },
  CUSTOM_TRANSFORMATION: {
    name: APP_ROUTE_NAMES.CUSTOM_TRANSFORMATION,
    path: '/customTransformation',
  },
  VOICE_TRANSFORMATION: {
    name: APP_ROUTE_NAMES.VOICE_TRANSFORMATION,
    path: '/voiceTransformation',
  },
  CHAT_PROMPTS: { name: APP_ROUTE_NAMES.CHAT_PROMPTS, path: '/chatPrompts' },
  SNIPPETS: { name: APP_ROUTE_NAMES.SNIPPETS, path: '/snippets' },
} as const

export type AppRoutePath = (typeof APP_ROUTES)[keyof typeof APP_ROUTES]['path']

export const MODE_ROUTE_MAP: Record<ActivationMode, AppRoutePath> = {
  [ActivationMode.SELECTION_ACTIONS]: APP_ROUTES.SELECT.path,
  [ActivationMode.VOICE]: APP_ROUTES.VOICE.path,
  [ActivationMode.VOICE_COMMANDS]: APP_ROUTES.VOICE_COMMANDS.path,
  [ActivationMode.CORRECTION]: APP_ROUTES.CORRECTION.path,
  [ActivationMode.TRANSLATION]: APP_ROUTES.TRANSLATE.path,
  [ActivationMode.STYLING]: APP_ROUTES.STYLING.path,
  [ActivationMode.TRANSFORMATION]: APP_ROUTES.TRANSFORMATION.path,
  [ActivationMode.CUSTOM_TRANSFORMATION]: APP_ROUTES.CUSTOM_TRANSFORMATION.path,
  [ActivationMode.VOICE_TRANSFORMATION]: APP_ROUTES.VOICE_TRANSFORMATION.path,
  [ActivationMode.CHAT_PROMPTS]: APP_ROUTES.CHAT_PROMPTS.path,
  [ActivationMode.SNIPPETS]: APP_ROUTES.SNIPPETS.path,
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
  ActivationMode.VOICE_COMMANDS,
  ActivationMode.CORRECTION,
  ActivationMode.VOICE_CHAT,
  ActivationMode.TRANSLATION,
  ActivationMode.STYLING,
  ActivationMode.TRANSFORMATION,
  ActivationMode.CUSTOM_TRANSFORMATION,
  ActivationMode.VOICE_TRANSFORMATION,
  ActivationMode.CHAT_PROMPTS,
  ActivationMode.SNIPPETS,
  ActivationMode.EXTERNAL_ACCESS,
])

export function isQuickWindowMode(mode: ActivationMode | null): boolean {
  return mode !== null && QUICK_WINDOW_MODES.has(mode)
}

/**
 * Whether an activation of `mode` shows the window this code runs in. The
 * desktop state is shared: its `isWindowShown` and `activationId` may belong to
 * the other window.
 */
export function isModeOfWindow(
  mode: ActivationMode | null,
  isQuick: boolean
): boolean {
  return isQuickWindowMode(mode) === isQuick
}

export function resolveModeRoute(mode: ActivationMode | null): AppRoutePath {
  return mode ? MODE_ROUTE_MAP[mode] : APP_ROUTES.HOME.path
}
