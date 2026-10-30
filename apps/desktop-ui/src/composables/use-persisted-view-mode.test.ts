import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

import { FakeDesktopError } from '../test/fake-desktop-backend'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import { useDesktopStore } from '../stores/desktop'
import {
  usePersistedDiffMode,
  usePersistedTranslationViewMode,
} from './use-persisted-view-mode'

const mocks = vi.hoisted(() => ({ toastKey: vi.fn() }))

vi.mock('./use-toast', () => ({
  default: () => ({ toastKey: mocks.toastKey }),
}))

const saveFailure = () => {
  throw new FakeDesktopError({ code: 'operationFailed', message: 'io' })
}

let desktop: TestDesktop
let scope: ReturnType<typeof effectScope>

beforeEach(async () => {
  scope = effectScope()
  const userConfig = structuredClone(DEFAULT_USER_CONFIG) as UserConfig
  userConfig.editor.diffViewMode = 'unified'
  userConfig.translation.viewMode = 'split'
  desktop = await loadFakeDesktop({ userConfig })
})

afterEach(() => {
  scope.stop()
  desktop.dispose()
})

const savedConfigs = () =>
  desktop.backend.callsOf('save_user_config').map((call) => call.userConfig)

describe('usePersistedDiffMode', () => {
  it('stores a picked mode and follows a mode stored elsewhere', async () => {
    const { diffMode, cycleMode } = scope.run(() => usePersistedDiffMode())!
    expect(diffMode.value).toBe('unified')

    cycleMode()
    await vi.waitFor(() => expect(savedConfigs()).toHaveLength(1))
    expect(savedConfigs()[0]!.editor.diffViewMode).toBe(diffMode.value)
    expect(desktop.backend.userConfig.editor.diffViewMode).toBe(diffMode.value)

    desktop.setState({
      userConfig: {
        ...desktop.backend.userConfig,
        editor: {
          ...desktop.backend.userConfig.editor,
          diffViewMode: 'result',
        },
      },
    })
    await nextTick()
    expect(diffMode.value).toBe('result')
    // the mode came from the settings: nothing to store
    expect(savedConfigs()).toHaveLength(1)
  })
})

it.each(['diff', 'translation'] as const)(
  'rolls back %s mode and reports rejected saves',
  async (kind) => {
    desktop.backend.handle('save_user_config', saveFailure)
    const mode = scope.run(() =>
      kind === 'diff'
        ? usePersistedDiffMode().diffMode
        : usePersistedTranslationViewMode(() => true).viewMode
    )!
    const initial = mode.value
    mode.value = 'result'
    await vi.waitFor(() =>
      expect(mocks.toastKey).toHaveBeenCalledWith(
        'settings.saveFailed',
        'error'
      )
    )
    expect(mode.value).toBe(initial)
    expect(savedConfigs()).toHaveLength(1)
    expect(useDesktopStore().userConfig.editor.diffViewMode).toBe('unified')
  }
)

it('does not roll back a newer choice when an older save fails', async () => {
  let fail!: () => void
  desktop.backend.handle(
    'save_user_config',
    () =>
      new Promise((_resolve, reject) => {
        fail = () =>
          reject(
            new FakeDesktopError({ code: 'operationFailed', message: 'io' })
          )
      })
  )
  const { diffMode } = scope.run(() => usePersistedDiffMode())!
  diffMode.value = 'result'
  await vi.waitFor(() => expect(savedConfigs()).toHaveLength(1))
  diffMode.value = 'split'
  await nextTick()
  fail()
  await vi.waitFor(() => expect(savedConfigs()).toHaveLength(2))
  await nextTick()
  expect(diffMode.value).toBe('split')
  expect(mocks.toastKey).not.toHaveBeenCalled()
})
