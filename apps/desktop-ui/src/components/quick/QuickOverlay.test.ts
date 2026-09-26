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
  params: { mode: 'write', isWindowShown: true, activationId: 1 },
  callFunction: vi.fn(async () => ({ success: true })),
  focus: vi.fn(),
  closeWindow: vi.fn(),
  markDismissed: vi.fn(),
  modals: { currentModal: 'none', pendingModal: null as string | null },
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({
    params: reactive(mocks.params),
    callFunction: mocks.callFunction,
  }),
}))
vi.mock('../../stores/writerInput', () => ({
  useWriterInputStore: () => ({
    focus: mocks.focus,
    markDismissed: mocks.markDismissed,
  }),
}))
vi.mock('../../stores/menuModals', () => ({
  MenuModals: { NONE: 'none' },
  useMenuModalsStore: () =>
    Object.assign(reactive(mocks.modals), {
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
  default: {
    template:
      '<div><div class="write-frame"><textarea /></div><p class="write-hint" /></div>',
  },
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

  it('keeps the quick window when clicking the shortcut hint', async () => {
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
      await wrapper.find('.write-hint').trigger('pointerdown')
      await wrapper.find('textarea').trigger('pointerdown')
      expect(mocks.callFunction).not.toHaveBeenCalledWith(
        'dismissQuickWindow',
        []
      )
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
      expect(mocks.markDismissed).toHaveBeenCalledOnce()
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps the step after the input when clicking outside the card', async () => {
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
    const modals = reactive(mocks.modals)
    modals.currentModal = 'insert'
    const wrapper = mount(QuickOverlay)
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      modals.currentModal = 'none'
      modals.pendingModal = 'insert'
      await nextTick()
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(mocks.callFunction).not.toHaveBeenCalledWith(
        'dismissQuickWindow',
        []
      )
      expect(mocks.markDismissed).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
      modals.currentModal = 'none'
      modals.pendingModal = null
    }
  })
})

describe('quick overlay input region', () => {
  const rects: Record<string, DOMRect> = {
    'write-frame': new DOMRect(8, 420, 784, 40),
    'write-hint': new DOMRect(8, 468, 300, 24),
  }

  it('takes clicks only on the input while nothing else is shown', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 500)
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        return rects[this.className] ?? new DOMRect()
      })
    const params = reactive(mocks.params)
    params.mode = 'write'
    params.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      await vi.waitFor(() =>
        expect(mocks.callFunction).toHaveBeenCalledWith('setQuickInputRegion', [
          { x: 0, y: 412, width: 800, height: 88 },
        ])
      )

      mocks.callFunction.mockClear()
      params.mode = 'voice'
      await vi.waitFor(() =>
        expect(mocks.callFunction).toHaveBeenCalledWith('setQuickInputRegion', [
          null,
        ])
      )
    } finally {
      wrapper.unmount()
      rectSpy.mockRestore()
      params.mode = 'write'
    }
  })
})
