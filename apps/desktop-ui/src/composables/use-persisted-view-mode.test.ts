import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'

import {
  usePersistedDiffMode,
  usePersistedTranslationViewMode,
} from './use-persisted-view-mode'

const mocks = vi.hoisted(() => ({
  userConfig: {} as {
    editor: { diffViewMode?: string }
    translation: { viewMode?: string }
  },
  toastKey: vi.fn(),
  updateUserConfig: vi.fn(),
}))

vi.mock('./use-toast', () => ({
  default: () => ({ toastKey: mocks.toastKey }),
}))

vi.mock('../stores/desktop', () => ({
  useDesktopStore: () => ({
    get userConfig() {
      return mocks.userConfig
    },
    updateUserConfig: mocks.updateUserConfig,
  }),
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.updateUserConfig.mockResolvedValue({ success: true })
})

describe('usePersistedDiffMode', () => {
  it('stores a picked mode and follows a mode stored elsewhere', async () => {
    mocks.userConfig = reactive({
      editor: { diffViewMode: 'unified' },
      translation: { viewMode: 'parallel' },
    })
    const { diffMode, cycleMode } = usePersistedDiffMode()
    expect(diffMode.value).toBe('unified')

    cycleMode()
    await nextTick()
    expect(mocks.updateUserConfig).toHaveBeenCalledWith({
      editor: { diffViewMode: diffMode.value },
    })

    mocks.updateUserConfig.mockClear()
    mocks.userConfig.editor.diffViewMode = 'result'
    await nextTick()
    expect(diffMode.value).toBe('result')
    // the mode came from the settings: nothing to store
    expect(mocks.updateUserConfig).not.toHaveBeenCalled()
  })
})

it.each(['diff', 'translation'] as const)(
  'rolls back %s mode and reports rejected saves',
  async (kind) => {
    mocks.userConfig = reactive({
      editor: { diffViewMode: 'unified' },
      translation: { viewMode: 'parallel' },
    })
    mocks.updateUserConfig.mockResolvedValue({ success: false, error: 'io' })
    const scope = effectScope()
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
    expect(mocks.updateUserConfig).toHaveBeenCalledOnce()
    scope.stop()
  }
)

it('does not roll back a newer choice when an older save fails', async () => {
  mocks.userConfig = reactive({
    editor: { diffViewMode: 'unified' },
    translation: {},
  })
  let finish!: (value: { success: false; error: string }) => void
  mocks.updateUserConfig.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const scope = effectScope()
  const { diffMode } = scope.run(() => usePersistedDiffMode())!
  diffMode.value = 'result'
  await nextTick()
  diffMode.value = 'split'
  await nextTick()
  finish({ success: false, error: 'io' })
  await nextTick()
  expect(diffMode.value).toBe('split')
  expect(mocks.toastKey).not.toHaveBeenCalled()
  scope.stop()
})

it('recovers from a thrown transport error', async () => {
  mocks.userConfig = reactive({
    editor: { diffViewMode: 'unified' },
    translation: {},
  })
  mocks.updateUserConfig.mockRejectedValue(new Error('transport'))
  const scope = effectScope()
  const { diffMode } = scope.run(() => usePersistedDiffMode())!
  diffMode.value = 'result'
  await vi.waitFor(() => expect(mocks.toastKey).toHaveBeenCalledOnce())
  expect(diffMode.value).toBe('unified')
  scope.stop()
})
