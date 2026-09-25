import { mount } from '@vue/test-utils'
import {
  defineComponent,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import QuickOverlay from './QuickOverlay.vue'

const mocks = vi.hoisted(() => ({
  params: { mode: 'write', isWindowShown: true },
  callFunction: vi.fn(async () => {}),
  focus: vi.fn(),
  closeWindow: vi.fn(),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({
    params: reactive(mocks.params),
    callFunction: mocks.callFunction,
  }),
}))
vi.mock('../../stores/writerInput', () => ({
  useWriterInputStore: () => ({ focus: mocks.focus, markDismissed: vi.fn() }),
}))
vi.mock('../../stores/menuModals', () => ({
  MenuModals: { NONE: 'none' },
  useMenuModalsStore: () => ({
    currentModal: 'none',
    pendingModal: null,
    cancelPending: vi.fn(),
    closeAll: vi.fn(),
  }),
}))
vi.mock('../../stores/quickDismiss', () => ({
  useQuickDismissStore: () => ({ isHeld: false }),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setSize: vi.fn(async () => {}),
    onFocusChanged: vi.fn(async () => () => {}),
    isVisible: vi.fn(async () => true),
    isFocused: vi.fn(async () => true),
  }),
}))
vi.mock('../../views/WriteModeView.vue', () => ({
  default: { template: '<textarea />' },
}))
vi.mock('../../views/AiTaskView.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../../views/SelectModeView.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../../views/VoiceView.vue', () => ({
  default: defineComponent({
    setup() {
      const onKey = (event: KeyboardEvent) => {
        if (event.code === 'Escape') mocks.closeWindow()
      }
      onMounted(() => window.addEventListener('keyup', onKey))
      onUnmounted(() => window.removeEventListener('keyup', onKey))
      return () => null
    },
  }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('quick overlay keyboard ownership', () => {
  it('does not let the hidden voice screen close the writing window on Escape', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    const params = reactive(mocks.params)
    params.mode = 'write'
    params.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.closeWindow).not.toHaveBeenCalled()

      params.mode = 'voice'
      await nextTick()
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.closeWindow).toHaveBeenCalledOnce()

      params.mode = 'write'
      await nextTick()
      mocks.closeWindow.mockClear()
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.closeWindow).not.toHaveBeenCalled()
      expect(wrapper.find('textarea').exists()).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('dismisses quick window when clicking outside the card', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    const params = reactive(mocks.params)
    params.mode = 'write'
    params.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(mocks.callFunction).toHaveBeenCalledWith('dismissQuickWindow', [])
    } finally {
      wrapper.unmount()
    }
  })
})
