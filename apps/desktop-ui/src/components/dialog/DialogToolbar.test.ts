import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useDialogStore } from '../../stores/dialog'
import DialogToolbar from './DialogToolbar.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu from '../common/DropdownMenu.vue'
import IconButton from '../common/IconButton.vue'

vi.mock('./DialogLanguageRoute.vue', () => ({
  default: { template: '<div class="dialog-route-stub" />' },
}))
vi.mock('./DialogLevel.vue', () => ({
  default: { template: '<div class="dialog-level-stub" />' },
}))
vi.mock('./DialogRecordingIndicator.vue', () => ({
  default: { template: '<div class="dialog-recording-stub" />' },
}))

describe('DialogToolbar.vue', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = true
      }),
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false
      }),
    })
    desktop = await loadFakeDesktop({
      userConfig: {
        ...DEFAULT_USER_CONFIG,
        editor: {
          ...DEFAULT_USER_CONFIG.editor,
          history: { ...DEFAULT_USER_CONFIG.editor.history, storage: 'disk' },
        },
        dialog: {
          ...DEFAULT_USER_CONFIG.dialog,
          isEnabled: true,
          isRecordingNoticeAcknowledged: true,
        },
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('does not contain "Start in compact mode" in start options dropdown', () => {
    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })
    const menu = wrapper.findComponent(DropdownMenu)
    const items = menu.props('items') as Array<{ label: string; icon: string }>
    expect(
      items.some(
        (item) =>
          item.label.includes('compact') ||
          item.icon.includes('picture-in-picture')
      )
    ).toBe(false)
    expect(
      items.some(
        (item) => item.label === i18n.global.t('dialog.listenRecording')
      )
    ).toBe(true)
  })

  it('starts immediately when clicking Listen with an empty transcript', async () => {
    const dialog = useDialogStore()
    const startSpy = vi
      .spyOn(dialog, 'start')
      .mockImplementation(async () => {})

    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const startButton = wrapper.find('.dialog-toolbar-run')
    expect(startButton.text()).toBe(i18n.global.t('dialog.listen'))
    await startButton.trigger('click')
    await flushPromises()

    expect(startSpy).toHaveBeenCalledTimes(1)
    const modals = wrapper.findAllComponents(ConfirmModal)
    for (const modal of modals) {
      expect(modal.props('open')).toBe(false)
    }
  })

  it('resumes without clearing when clicking Resume with existing transcript', async () => {
    const dialog = useDialogStore()
    const startSpy = vi
      .spyOn(dialog, 'start')
      .mockImplementation(async () => {})
    dialog.segments = [
      {
        id: '1',
        side: 'remote',
        startMs: 0,
        endMs: 100,
        text: 'Existing phrase',
        isFinal: true,
        translationState: 'idle',
      },
    ]

    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const runButton = wrapper.find('.dialog-toolbar-run')
    expect(runButton.text()).toBe(i18n.global.t('dialog.resume'))
    await runButton.trigger('click')
    await flushPromises()

    expect(startSpy).toHaveBeenCalledTimes(1)
    const modals = wrapper.findAllComponents(ConfirmModal)
    for (const modal of modals) {
      expect(modal.props('open')).toBe(false)
    }
  })

  it('clears transcript when clicking Clear button', async () => {
    const dialog = useDialogStore()
    const clearSpy = vi
      .spyOn(dialog, 'clear')
      .mockImplementation(async () => {})
    dialog.segments = [
      {
        id: '1',
        side: 'remote',
        startMs: 0,
        endMs: 100,
        text: 'Existing phrase',
        isFinal: true,
        translationState: 'idle',
      },
    ]

    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const clearButton = wrapper.find('.dialog-toolbar-clear')
    expect(clearButton.exists()).toBe(true)
    await clearButton.trigger('click')
    await flushPromises()

    expect(clearSpy).toHaveBeenCalledTimes(1)
  })

  it('disables compact mode button when not active, enables when active', async () => {
    const dialog = useDialogStore()
    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const collapseButton = wrapper
      .findAllComponents(IconButton)
      .find(
        (btn) =>
          btn.props('icon') === 'mdi:picture-in-picture-bottom-right-outline'
      )
    expect(collapseButton).toBeDefined()
    expect(collapseButton!.props('disabled')).toBe(true)

    // simulate active session
    dialog.status = 'running'
    await flushPromises()

    expect(collapseButton!.props('disabled')).toBe(false)
  })
})
