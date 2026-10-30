import { disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeDesktopError } from '../test/fake-desktop-backend'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useSettingsSessionStore } from './settings-session'

const mocks = vi.hoisted(() => ({ toastText: vi.fn() }))
vi.mock('./action-menu', () => ({
  useActionMenuStore: () => ({
    resolveMainActions: (actions: unknown[]) => actions,
    getRegisteredActions: () => [],
  }),
}))
vi.mock('./theme', () => ({ useThemeStore: () => ({ settings: {} }) }))
vi.mock('./plugin-runtime', () => ({
  usePluginRuntimeStore: () => ({ pluginFactories: [] }),
}))
vi.mock('./toast', () => ({
  useToastStore: () => ({
    addToast: vi.fn(),
    toastKey: vi.fn(),
    toastText: mocks.toastText,
  }),
}))
vi.mock('../lib/i18n', () => ({ translate: (key: string) => key }))

let desktop: TestDesktop
beforeEach(async () => {
  vi.clearAllMocks()
  desktop = await loadFakeDesktop()
  vi.useFakeTimers()
})
afterEach(async () => {
  disposePinia(desktop.pinia)
  await Promise.resolve()
  vi.useRealTimers()
  desktop.dispose()
})

describe('settings session ownership', () => {
  it('retains a failed page-exit save for the next settings mount', async () => {
    const session = useSettingsSessionStore()
    session.draft.appearance.theme = 'dark'
    desktop.backend.handle('save_user_config', () => {
      throw new FakeDesktopError({
        code: 'operationFailed',
        message: 'Unavailable',
      })
    })
    await session.persist()
    expect(mocks.toastText).toHaveBeenCalledWith(
      'toast.settingsSaveFailed: Unavailable',
      'error'
    )
    const reopened = useSettingsSessionStore()
    expect(reopened.draft.appearance.theme).toBe('dark')
    expect(reopened.isSaved()).toBe(false)
    desktop.backend.handle('save_user_config', ({ userConfig }) => {
      desktop.backend.userConfig = userConfig
      desktop.backend.touch()
      return desktop.backend.snapshot()
    })
    await reopened.persist()
    expect(reopened.isSaved()).toBe(true)
    expect(desktop.backend.callsOf('save_user_config')).toHaveLength(2)
    expect(desktop.backend.userConfig.appearance.theme).toBe('dark')
  })
})
