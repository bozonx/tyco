import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import { usePersistedDiffMode } from './use-persisted-view-mode'

const mocks = vi.hoisted(() => ({
  userConfig: {} as { editor: { diffViewMode?: string } },
  updateUserConfig: vi.fn(),
}))

vi.mock('../stores/desktop', () => ({
  useDesktopStore: () => ({
    get userConfig() {
      return mocks.userConfig
    },
    updateUserConfig: mocks.updateUserConfig,
  }),
}))

describe('usePersistedDiffMode', () => {
  it('stores a picked mode and follows a mode stored elsewhere', async () => {
    mocks.userConfig = reactive({ editor: { diffViewMode: 'unified' } })
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
