import router from '../../router'
import { APP_ROUTES, type AppRoutePath } from './routes'

export interface NavigationApi {
  push: (path: AppRoutePath) => Promise<void>
  currentPath: () => AppRoutePath
  isCurrent: (path: AppRoutePath) => boolean
  goToEditor: () => Promise<void>
  goToHistory: () => Promise<void>
  /** Opens the settings, on `tab` when given */
  goToConfig: (tab?: string) => Promise<void>
  goToChat: () => Promise<void>
}

export const appNavigation: NavigationApi = {
  async push(path: AppRoutePath) {
    await router.push(path)
  },
  currentPath() {
    return router.currentRoute.value.path as AppRoutePath
  },
  isCurrent(path: AppRoutePath) {
    return router.currentRoute.value.path === path
  },
  async goToEditor() {
    await router.push(APP_ROUTES.EDITOR.path)
  },
  async goToHistory() {
    await router.push(APP_ROUTES.HISTORY.path)
  },
  async goToConfig(tab?: string) {
    await router.push(
      tab
        ? { path: APP_ROUTES.CONFIG.path, query: { tab } }
        : APP_ROUTES.CONFIG.path
    )
  },
  async goToChat() {
    await router.push(APP_ROUTES.CHAT.path)
  },
}
