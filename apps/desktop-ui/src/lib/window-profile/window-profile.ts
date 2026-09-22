import { APP_ROUTES } from '../navigation/routes'

export type SheetTitleKey = 'nav.chat' | 'nav.history' | 'nav.settings'

export function sheetTitleKey(path: string): SheetTitleKey | null {
  switch (path) {
    case APP_ROUTES.CHAT.path:
      return 'nav.chat'
    case APP_ROUTES.HISTORY.path:
      return 'nav.history'
    case APP_ROUTES.CONFIG.path:
      return 'nav.settings'
    default:
      return null
  }
}
