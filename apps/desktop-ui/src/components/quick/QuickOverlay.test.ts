import { flushPromises, mount } from '@vue/test-utils'
import {
  defineComponent,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
} from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivationMode } from '@tyco/shared'

import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import QuickOverlay from './QuickOverlay.vue'

const mocks = vi.hoisted(() => ({
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
    label: 'quick',
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
      '<div><div class="write-live-preview" /><div class="write-frame"><textarea /></div><p class="write-hint" /></div>',
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
vi.mock('../../views/StylingView.vue', () => ({
  default: { template: '<div class="styling-view" />' },
}))
vi.mock('../../views/TransformationView.vue', () => ({
  default: { template: '<div class="transformation-view" />' },
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

let desktop: TestDesktop
const sent = async (
  command: Parameters<TestDesktop['backend']['callsOf']>[0]
) => {
  await flushPromises()
  return desktop.backend.callsOf(command)
}

beforeEach(async () => {
  desktop = await loadFakeDesktop(
    { mode: 'quickInput', activation: { activationId: 1 } },
    'quick'
  )
  desktop.backend.handle('hide_window', () => undefined)
  desktop.backend.handle('hide_quick_window_on_blur', () => undefined)
  desktop.backend.handle('set_quick_input_region', () => undefined)
})

afterEach(() => {
  desktop.dispose()
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
    desktop.setState({ mode: 'quickInput' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.hideWindow).not.toHaveBeenCalled()

      desktop.setState({ mode: 'voice' })
      await nextTick()
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
      expect(mocks.hideWindow).toHaveBeenCalledOnce()

      desktop.setState({ mode: 'quickInput' })
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
    desktop.setState({ mode: 'quickInput' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      await wrapper.find('.write-live-preview').trigger('pointerdown')
      await wrapper.find('.write-hint').trigger('pointerdown')
      await wrapper.find('textarea').trigger('pointerdown')
      expect(await sent('hide_quick_window_on_blur')).toEqual([])
      expect(await sent('hide_window')).toEqual([])
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
    desktop.setState({ mode: 'quickInput' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(await sent('hide_window')).not.toEqual([])
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
    desktop.setState({ mode: 'quickInput' })
    desktop.setState({ isWindowShown: true })
    const modals = reactive(mocks.modals)
    modals.currentModal = 'insert'
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      modals.currentModal = 'none'
      modals.pendingModal = 'insert'
      await nextTick()
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(await sent('hide_quick_window_on_blur')).toEqual([])
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
    desktop.setState({ mode: 'quickInput' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      await vi.waitFor(() =>
        expect(
          desktop.backend.callsOf('set_quick_input_region')
        ).toContainEqual({
          activationId: 1,
          region: { x: 0, y: 412, width: 800, height: 88 },
        })
      )

      // the dictation bar leaves the screen above it clickable too
      desktop.backend.calls.length = 0
      desktop.setState({ mode: 'voice' })
      await vi.waitFor(() =>
        expect(
          desktop.backend.callsOf('set_quick_input_region')
        ).toContainEqual({
          activationId: 1,
          region: { x: 0, y: 364, width: 800, height: 136 },
        })
      )

      desktop.backend.calls.length = 0
      desktop.setState({ mode: 'aiTasks' })
      await vi.waitFor(() =>
        expect(
          desktop.backend.callsOf('set_quick_input_region')
        ).toContainEqual({ activationId: 1, region: null })
      )
    } finally {
      wrapper.unmount()
      rectSpy.mockRestore()
      desktop.setState({ mode: 'quickInput' })
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

  it('renders styling and transformation views in quick overlay', async () => {
    stubResizeObserver()
    desktop.setState({ mode: 'styling' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      expect(wrapper.find('.styling-view').exists()).toBe(true)
      desktop.setState({ mode: 'transformation' })
      await nextTick()
      expect(wrapper.find('.transformation-view').exists()).toBe(true)
    } finally {
      wrapper.unmount()
      desktop.setState({ mode: 'quickInput' })
    }
  })

  it('keeps the menus of the other modes when clicking outside the card', async () => {
    stubResizeObserver()
    desktop.setState({ mode: 'aiTasks' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      await wrapper.find('.quick-overlay-root').trigger('pointerdown')
      expect(await sent('hide_quick_window_on_blur')).toEqual([])
    } finally {
      wrapper.unmount()
      desktop.setState({ mode: 'quickInput' })
    }
  })

  const loseFocus = async (mode: string, modal = 'none') => {
    stubResizeObserver()
    vi.useFakeTimers()
    desktop.setState({ mode: mode as ActivationMode })
    desktop.setState({ isWindowShown: true })
    mocks.modals.currentModal = modal
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      await vi.waitFor(() => expect(mocks.focusHandlers).toHaveLength(1))
      mocks.windowFocused = false
      mocks.focusHandlers[0]!({ payload: false })
      await vi.advanceTimersByTimeAsync(200)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
      desktop.setState({ mode: 'quickInput' })
      mocks.modals.currentModal = 'none'
    }
  }

  it.each([
    'selectionActions',
    'aiTasks',
    'commandLauncher',
    'translation',
    'styling',
    'transformation',
  ])('dismisses the %s menu when the focus goes elsewhere', async (mode) => {
    await loseFocus(mode)
    expect(await sent('hide_quick_window_on_blur')).not.toEqual([])
    expect(await sent('hide_window')).toEqual([])
  })

  it('keeps the step after the menu when the focus goes elsewhere', async () => {
    await loseFocus('selectionActions', 'translate')
    expect(await sent('hide_quick_window_on_blur')).toEqual([])
  })

  it('keeps a command past the list when the focus goes elsewhere', async () => {
    mocks.launcher.stage = { kind: 'prepare' }
    await loseFocus('commandLauncher')
    expect(await sent('hide_quick_window_on_blur')).toEqual([])
  })

  it('keeps a correction when the focus goes elsewhere', async () => {
    await loseFocus('correction')
    expect(await sent('hide_quick_window_on_blur')).toEqual([])
  })

  it('tells when the window does not take the keys', async () => {
    stubResizeObserver()
    vi.useFakeTimers()
    desktop.setState({ mode: 'aiTasks' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
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
      desktop.setState({ mode: 'quickInput' })
    }
  })

  it('keeps a hidden menu but resets it for the next activation', async () => {
    stubResizeObserver()
    desktop.setState({ mode: 'aiTasks' })
    desktop.setState({ isWindowShown: true })
    const wrapper = mount(QuickOverlay, {
      global: { plugins: [desktop.pinia] },
    })
    try {
      expect(mocks.aiTaskMounts).toBe(1)

      desktop.setState({ isWindowShown: false })
      await nextTick()
      expect(mocks.aiTaskMounts).toBe(1)
      expect(mocks.aiTaskUnmounts).toBe(0)
      mocks.cancelAndCloseAll.mockClear()
      desktop.setState({ isWindowShown: true })
      desktop.setState({
        activationId: desktop.backend.activation.activationId + 1,
      })
      await nextTick()
      expect(mocks.aiTaskMounts).toBe(2)
      expect(mocks.aiTaskUnmounts).toBe(1)
      expect(mocks.cancelAndCloseAll).toHaveBeenCalledOnce()

      desktop.setState({ mode: 'quickInput' })
      await nextTick()
      expect(mocks.aiTaskUnmounts).toBe(2)
    } finally {
      wrapper.unmount()
      desktop.setState({ mode: 'quickInput' })
    }
  })
})
