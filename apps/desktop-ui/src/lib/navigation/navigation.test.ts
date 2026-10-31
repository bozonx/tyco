import { shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import { createAppNavigation } from './navigation'
import { APP_ROUTES } from './routes'

describe('createAppNavigation', () => {
  function setup(profile: unknown) {
    const router = {
      push: vi.fn<Router['push']>().mockResolvedValue(undefined),
      replace: vi.fn<Router['replace']>().mockResolvedValue(undefined),
      currentRoute: shallowRef<{
        path: string
        query: Record<string, unknown>
      }>({ path: APP_ROUTES.CHAT.path, query: { profile } }),
    }
    return { router, navigation: createAppNavigation(router) }
  }
  it('accepts only a nonempty scalar profile query', () => {
    expect(setup('writer').navigation.currentProfileId()).toBe('writer')
    for (const profile of [undefined, null, '', ['writer', 'other']]) {
      expect(setup(profile).navigation.currentProfileId()).toBeNull()
    }
  })
  it('uses the injected router for navigation and current route checks', async () => {
    const { router, navigation } = setup('writer')
    expect(navigation.currentPath()).toBe(APP_ROUTES.CHAT.path)
    expect(navigation.isCurrent(APP_ROUTES.CHAT.path)).toBe(true)
    await navigation.goToConfig('plugins')
    expect(router.push).toHaveBeenLastCalledWith({
      path: APP_ROUTES.CONFIG.path,
      query: { tab: 'plugins' },
    })
    await navigation.goToProfileChat('editor')
    expect(router.push).toHaveBeenLastCalledWith({
      path: APP_ROUTES.CHAT.path,
      query: { profile: 'editor' },
    })
  })
  it('keeps the settings tab in the address only on the settings page', async () => {
    const { router, navigation } = setup('writer')
    await navigation.rememberConfigTab('llm')
    expect(router.replace).not.toHaveBeenCalled()
    router.currentRoute.value = {
      path: APP_ROUTES.CONFIG.path,
      query: { tab: 'general' },
    }
    await navigation.rememberConfigTab('general')
    expect(router.replace).not.toHaveBeenCalled()
    await navigation.rememberConfigTab('llm')
    expect(router.replace).toHaveBeenCalledWith({
      path: APP_ROUTES.CONFIG.path,
      query: { tab: 'llm' },
    })
  })
})
