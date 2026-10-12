import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'

import { useSettingsSessionStore } from './settings-session'

const mocks = vi.hoisted(() => ({
  config: {} as typeof DEFAULT_USER_CONFIG,
  save: vi.fn(),
  toastText: vi.fn(),
}))
vi.mock('./ipc', () => ({
  useIpcStore: () => ({
    params: {
      get userConfig() {
        return mocks.config
      },
    },
    saveUserConfig: mocks.save,
  }),
}))
vi.mock('./action-menu', () => ({
  useActionMenuStore: () => ({
    resolveMainActions: (actions: unknown[]) => actions,
    getRegisteredActions: () => [],
  }),
}))
vi.mock('./theme', () => ({ useThemeStore: () => ({ settings: {} }) }))
vi.mock('../plugins', () => ({ pluginIndexes: [] }))
vi.mock('../composables/use-toast', () => ({
  default: () => ({ toastText: mocks.toastText }),
}))
vi.mock('../lib/i18n', () => ({ translate: (key: string) => key }))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
  mocks.config = reactive(structuredClone(DEFAULT_USER_CONFIG))
  mocks.save.mockImplementation(async (next) => ({
    success: true,
    result: next,
  }))
})
afterEach(async () => {
  disposePinia(pinia)
  await Promise.resolve()
  vi.useRealTimers()
})

describe('settings session ownership', () => {
  it('retains a failed page-exit save for the next settings mount', async () => {
    const session = useSettingsSessionStore()
    session.draft.theme = 'dark'
    mocks.save.mockResolvedValueOnce({ success: false, error: 'Unavailable' })
    await session.persist()
    expect(mocks.toastText).toHaveBeenCalledWith(
      'toast.settingsSaveFailed: Unavailable',
      'error'
    )
    const reopened = useSettingsSessionStore()
    expect(reopened.draft.theme).toBe('dark')
    expect(reopened.isSaved()).toBe(false)
    await reopened.persist()
    expect(reopened.isSaved()).toBe(true)
    expect(mocks.save).toHaveBeenCalledTimes(2)
  })
})
