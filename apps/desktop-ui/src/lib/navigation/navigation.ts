import type { Router } from 'vue-router'
import { APP_ROUTES, type AppRoutePath } from './routes'

export interface NavigationApi {
  push: (path: AppRoutePath) => Promise<void>
  currentPath: () => AppRoutePath
  currentProfileId: () => string | null
  isCurrent: (path: AppRoutePath) => boolean
  goToEditor: () => Promise<void>
  goToHistory: () => Promise<void>
  /** Opens the settings, on `tab` when given */
  goToConfig: (tab?: string) => Promise<void>
  goToChat: () => Promise<void>
  goToProfileChat: (profileId: string) => Promise<void>
}

export function createAppNavigation(router: {
  push: Router['push']
  currentRoute: {
    readonly value: { path: string; query: Record<string, unknown> }
  }
}): NavigationApi {
  return {
    async push(path: AppRoutePath) {
      await router.push(path)
    },
    currentPath() {
      return router.currentRoute.value.path as AppRoutePath
    },
    currentProfileId() {
      const profile = router.currentRoute.value.query.profile
      return typeof profile === 'string' && profile ? profile : null
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
    async goToProfileChat(profileId: string) {
      await router.push({
        path: APP_ROUTES.CHAT.path,
        query: { profile: profileId },
      })
    },
  }
}
