import { START_MODES } from '@shared'

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
} as const

export const APP_ROUTES = {
  HOME: {
    name: APP_ROUTE_NAMES.HOME,
    path: '/',
  },
  EDITOR: {
    name: APP_ROUTE_NAMES.EDITOR,
    path: '/editor',
  },
  HISTORY: {
    name: APP_ROUTE_NAMES.HISTORY,
    path: '/history',
  },
  CONFIG: {
    name: APP_ROUTE_NAMES.CONFIG,
    path: '/config',
  },
  CHAT: {
    name: APP_ROUTE_NAMES.CHAT,
    path: '/chat',
  },
  WRITE: {
    name: APP_ROUTE_NAMES.WRITE,
    path: '/write',
  },
  VOICE: {
    name: APP_ROUTE_NAMES.VOICE,
    path: '/voice',
  },
  AI_TASKS: {
    name: APP_ROUTE_NAMES.AI_TASKS,
    path: '/aiTasks',
  },
  SELECT: {
    name: APP_ROUTE_NAMES.SELECT,
    path: '/select',
  },
} as const

export type AppRouteName = (typeof APP_ROUTE_NAMES)[keyof typeof APP_ROUTE_NAMES]
export type AppRoutePath = (typeof APP_ROUTES)[keyof typeof APP_ROUTES]['path']

export const MODE_ROUTE_MAP: Record<START_MODES, AppRoutePath> = {
  [START_MODES.SELECT]: APP_ROUTES.SELECT.path,
  [START_MODES.VOICE]: APP_ROUTES.VOICE.path,
  [START_MODES.AI_TASKS]: APP_ROUTES.AI_TASKS.path,
  [START_MODES.EDITOR]: APP_ROUTES.EDITOR.path,
  [START_MODES.WRITE]: APP_ROUTES.WRITE.path,
  [START_MODES.CHAT]: APP_ROUTES.CHAT.path,
}

export function resolveModeRoute(mode: START_MODES | null): AppRoutePath {
  return mode ? MODE_ROUTE_MAP[mode] : APP_ROUTES.HOME.path
}
