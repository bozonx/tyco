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

describe('settings drafts on exit', () => {
  it('saves the config and every registered draft, and tells a failed one', async () => {
    const session = useSettingsSessionStore()
    const profile = vi.fn(async () => true)
    const unregister = session.registerDraft(profile)
    expect(await session.flushAll()).toBe(true)
    expect(profile).toHaveBeenCalledOnce()
    const failing = vi.fn(async () => {
      throw new Error('Unavailable')
    })
    session.registerDraft(failing)
    expect(await session.flushAll()).toBe(false)
    unregister()
    expect(profile).toHaveBeenCalledTimes(2)
  })
})

describe('settings autosave race condition', () => {
  it('does not show conflict toast when user clicks multiple times during autosave', async () => {
    let finishSave!: () => void
    let callCount = 0
    desktop.backend.handle('save_user_config', ({ userConfig }) => {
      desktop.backend.userConfig = userConfig
      desktop.backend.touch()
      callCount++
      if (callCount === 1) {
        return new Promise((resolve) => {
          finishSave = () => resolve(desktop.backend.snapshot())
        })
      }
      return desktop.backend.snapshot()
    })

    const session = useSettingsSessionStore()
    session.draft.appearance.theme = 'dark'
    const firstPersist = session.persist()
    await Promise.resolve()

    session.draft.appearance.theme = 'light'

    finishSave()
    await firstPersist

    expect(mocks.toastText).not.toHaveBeenCalledWith(
      'settings.saveConflictToast',
      'warn'
    )
    expect(session.conflicts).toEqual([])
    expect(session.draft.appearance.theme).toBe('light')
    expect(session.isSaved()).toBe(true)
    expect(desktop.backend.userConfig.appearance.theme).toBe('light')
    expect(callCount).toBe(2)
  })
})
