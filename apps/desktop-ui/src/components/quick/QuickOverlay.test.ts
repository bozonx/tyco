import { mount } from '@vue/test-utils'
import {
  defineComponent,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
} from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import QuickOverlay from './QuickOverlay.vue'

const mocks = vi.hoisted(() => ({
  desktopState: { mode: 'quickInput', isWindowShown: true, activationId: 1 },
  call: vi.fn(async () => ({ success: true, result: undefined })),
  focus: vi.fn(),
  hideWindow: vi.fn(),
  markDismissed: vi.fn(),
  modals: { currentModal: 'none', pendingModal: null as string | null },
  windowFocused: true,
  focusHandlers: [] as ((event: { payload: boolean }) => void)[],
  aiTaskMounts: 0,
  aiTaskUnmounts: 0,
  cancelAndCloseAll: vi.fn(),
  launcher: { stage: { kind: 'list' } },
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ call: mocks.call }),
}))
vi.mock('../../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../../test/desktop-store')
  return {
    useDesktopStore: () => mockDesktopStore(() => reactive(mocks.desktopState)),
  }
})
vi.mock('../../stores/quick-input', () => ({
  useQuickInputStore: () => ({
    requestFocus: mocks.focus,
    markDismissed: mocks.markDismissed,
  }),
}))
vi.mock('../../stores/menu-modals', () => ({
  MenuModals: { NONE: 'none' },
  useMenuModalsStore: () =>
    Object.assign(reactive(mocks.modals), {
      cancelPending: vi.fn(),
      cancelAndCloseAll: mocks.cancelAndCloseAll,
      closeAll: vi.fn(),
    }),
}))
vi.mock('../../stores/command-launcher', () => ({
  useCommandLauncherStore: () => reactive(mocks.launcher),
}))
vi.mock('../../stores/quick-dismiss', () => ({
  useQuickDismissStore: () => ({ isHeld: false }),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setSize: vi.fn(async () => {}),
    onFocusChanged: vi.fn(
      async (handler: (event: { payload: boolean }) => void) => {
        mocks.focusHandlers.push(handler)
        return () => {}
      }
    ),
    isVisible: vi.fn(async () => true),
    isFocused: vi.fn(async () => mocks.windowFocused),
  }),
}))
vi.mock('../../views/WriteView.vue', () => ({
  default: {
    template:
      '<div><div class="write-frame"><textarea /></div><p class="write-hint" /></div>',
  },
}))
vi.mock('../../views/AiTaskView.vue', () => ({
  default: {
    template: '<div />',
    mounted: () => mocks.aiTaskMounts++,
    unmounted: () => mocks.aiTaskUnmounts++,
  },
}))
vi.mock('../../views/SelectionView.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../../views/CommandLauncherView.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../../views/CorrectionView.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../../views/TranslateView.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../../views/VoiceView.vue', () => ({
  default: defineComponent({
    setup() {
      const onKey = (event: KeyboardEvent) => {
        if (event.code === 'Escape') mocks.hideWindow()
      }
      onMounted(() => window.addEventListener('keyup', onKey))
      onUnmounted(() => window.removeEventListener('keyup', onKey))
      return () => h('div', { class: 'voice-bar' })
    },
  }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocks.windowFocused = true
  mocks.focusHandlers = []
  mocks.aiTaskMounts = 0
  mocks.aiTaskUnmounts = 0
  mocks.launcher.stage = { kind: 'list' }
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
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'quickInput'
    desktopState.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.hideWindow).not.toHaveBeenCalled()

      desktopState.mode = 'voice'
      await nextTick()
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.hideWindow).toHaveBeenCalledOnce()

      desktopState.mode = 'quickInput'
      await nextTick()
      mocks.hideWindow.mockClear()
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.hideWindow).not.toHaveBeenCalled()
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
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'quickInput'
    desktopState.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      await wrapper.find('.write-hint').trigger('pointerdown')
      await wrapper.find('textarea').trigger('pointerdown')
      expect(mocks.call).not.toHaveBeenCalledWith('hide_quick_window_on_blur')
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
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'quickInput'
    desktopState.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(mocks.call).toHaveBeenCalledWith('hide_window')
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
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'quickInput'
    desktopState.isWindowShown = true
    const modals = reactive(mocks.modals)
    modals.currentModal = 'insert'
    const wrapper = mount(QuickOverlay)
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      modals.currentModal = 'none'
      modals.pendingModal = 'insert'
      await nextTick()
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(mocks.call).not.toHaveBeenCalledWith('hide_quick_window_on_blur')
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
    'voice-bar': new DOMRect(8, 372, 784, 120),
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
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'quickInput'
    desktopState.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      await vi.waitFor(() =>
        expect(mocks.call).toHaveBeenCalledWith('set_quick_input_region', {
          region: { x: 0, y: 412, width: 800, height: 88 },
        })
      )

      // the dictation bar leaves the screen above it clickable too
      mocks.call.mockClear()
      desktopState.mode = 'voice'
      await vi.waitFor(() =>
        expect(mocks.call).toHaveBeenCalledWith('set_quick_input_region', {
          region: { x: 0, y: 364, width: 800, height: 136 },
        })
      )

      mocks.call.mockClear()
      desktopState.mode = 'aiTasks'
      await vi.waitFor(() =>
        expect(mocks.call).toHaveBeenCalledWith('set_quick_input_region', {
          region: null,
        })
      )
    } finally {
      wrapper.unmount()
      rectSpy.mockRestore()
      desktopState.mode = 'quickInput'
    }
  })
})

describe('quick overlay menus', () => {
  const stubResizeObserver = () =>
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )

  it('keeps the menus of the other modes when clicking outside the card', async () => {
    stubResizeObserver()
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'aiTasks'
    desktopState.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(mocks.call).not.toHaveBeenCalledWith('hide_quick_window_on_blur')
    } finally {
      wrapper.unmount()
      desktopState.mode = 'quickInput'
    }
  })

  const loseFocus = async (mode: string, modal = 'none') => {
    stubResizeObserver()
    vi.useFakeTimers()
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = mode
    desktopState.isWindowShown = true
    mocks.modals.currentModal = modal
    const wrapper = mount(QuickOverlay)
    try {
      await vi.waitFor(() => expect(mocks.focusHandlers).toHaveLength(1))
      mocks.windowFocused = false
      mocks.focusHandlers[0]!({ payload: false })
      await vi.advanceTimersByTimeAsync(200)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
      desktopState.mode = 'quickInput'
      mocks.modals.currentModal = 'none'
    }
  }

  it.each(['selectionActions', 'aiTasks', 'commandLauncher', 'translation'])(
    'dismisses the %s menu when the focus goes elsewhere',
    async (mode) => {
      await loseFocus(mode)
      expect(mocks.call).toHaveBeenCalledWith('hide_quick_window_on_blur')
      expect(mocks.call).not.toHaveBeenCalledWith('hide_window')
    }
  )

  it('keeps the step after the menu when the focus goes elsewhere', async () => {
    await loseFocus('selectionActions', 'translate')
    expect(mocks.call).not.toHaveBeenCalledWith('hide_quick_window_on_blur')
  })

  it('keeps a command past the list when the focus goes elsewhere', async () => {
    mocks.launcher.stage = { kind: 'prepare' }
    await loseFocus('commandLauncher')
    expect(mocks.call).not.toHaveBeenCalledWith('hide_quick_window_on_blur')
  })

  it('keeps a correction when the focus goes elsewhere', async () => {
    await loseFocus('correction')
    expect(mocks.call).not.toHaveBeenCalledWith('hide_quick_window_on_blur')
  })

  it('tells when the window does not take the keys', async () => {
    stubResizeObserver()
    vi.useFakeTimers()
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'aiTasks'
    desktopState.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      await vi.waitFor(() => expect(mocks.focusHandlers).toHaveLength(1))
      expect(wrapper.find('.quick-focus-hint').exists()).toBe(false)
      expect(document.documentElement.dataset.windowFocused).toBe('true')

      mocks.focusHandlers[0]!({ payload: false })
      await vi.advanceTimersByTimeAsync(200)
      expect(wrapper.find('.quick-focus-hint').exists()).toBe(true)
      expect(document.documentElement.dataset.windowFocused).toBe('false')

      mocks.focusHandlers[0]!({ payload: true })
      await nextTick()
      expect(wrapper.find('.quick-focus-hint').exists()).toBe(false)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
      desktopState.mode = 'quickInput'
    }
  })

  it('keeps a hidden menu but resets it for the next activation', async () => {
    stubResizeObserver()
    const desktopState = reactive(mocks.desktopState)
    desktopState.mode = 'aiTasks'
    desktopState.isWindowShown = true
    const wrapper = mount(QuickOverlay)
    try {
      expect(mocks.aiTaskMounts).toBe(1)

      desktopState.isWindowShown = false
      await nextTick()
      expect(mocks.aiTaskMounts).toBe(1)
      expect(mocks.aiTaskUnmounts).toBe(0)
      mocks.cancelAndCloseAll.mockClear()
      desktopState.isWindowShown = true
      desktopState.activationId++
      await nextTick()
      expect(mocks.aiTaskMounts).toBe(2)
      expect(mocks.aiTaskUnmounts).toBe(1)
      expect(mocks.cancelAndCloseAll).toHaveBeenCalledOnce()

      desktopState.mode = 'quickInput'
      await nextTick()
      expect(mocks.aiTaskUnmounts).toBe(2)
    } finally {
      wrapper.unmount()
      desktopState.mode = 'quickInput'
    }
  })
})
