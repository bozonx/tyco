import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useDesktopStore } from '../../stores/desktop'
import { useDialogStore } from '../../stores/dialog'
import DialogToolbar from './DialogToolbar.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import IconButton from '../common/IconButton.vue'

vi.mock('./DialogLanguageRoute.vue', () => ({
  default: { template: '<div class="dialog-route-stub" />' },
}))
vi.mock('./DialogLevel.vue', () => ({
  default: { template: '<div class="dialog-level-stub" />' },
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

  it('renders record toggle button with aria-pressed false by default', () => {
    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })
    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.text()).toContain(i18n.global.t('dialog.record'))
  })

  it('shows recording notice modal when toggling record on if not yet acknowledged', async () => {
    desktop.setUserConfig({
      dialog: {
        ...DEFAULT_USER_CONFIG.dialog,
        isEnabled: true,
        isRecordingNoticeAcknowledged: false,
      },
    })
    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })
    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    await toggle.trigger('click')
    await flushPromises()

    const noticeModal = wrapper
      .findAllComponents(ConfirmModal)
      .find((m) => m.props('title') === i18n.global.t('dialog.recordingNoticeTitle'))
    expect(noticeModal?.props('open')).toBe(true)

    // Confirm notice
    await noticeModal?.vm.$emit('confirm')
    await flushPromises()

    const desktopStore = useDesktopStore()
    expect(desktopStore.userConfig.dialog.isRecordingNoticeAcknowledged).toBe(true)
    const dialog = useDialogStore()
    expect(dialog.isRecordEnabled).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('true')
  })

  it('starts with recording when record toggle is enabled', async () => {
    const dialog = useDialogStore()
    const startSpy = vi
      .spyOn(dialog, 'start')
      .mockImplementation(async () => {})

    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    await toggle.trigger('click')
    await flushPromises()
    expect(dialog.isRecordEnabled).toBe(true)

    const startButton = wrapper.find('.dialog-toolbar-run')
    await startButton.trigger('click')
    await flushPromises()

    expect(startSpy).toHaveBeenCalledWith({ isRecording: true })
  })

  it('starts without recording when record toggle is disabled', async () => {
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

    expect(startSpy).toHaveBeenCalledWith({ isRecording: false })
  })

  it('shows REC indicator and timer when session is running with recording', async () => {
    const dialog = useDialogStore()
    dialog.status = 'running'
    dialog.recording = { file: 'rec-1.opus', startedAtMs: Date.now() - 5000 }
    dialog.isRecordEnabled = true

    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    expect(toggle.classes()).toContain('is-running')
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.attributes('title')).toBe(i18n.global.t('dialog.recordStopToChangeHint'))
    expect(toggle.find('.dialog-record-rec').text()).toBe('REC')
    expect(toggle.find('.dialog-record-dot-pulsing').exists()).toBe(true)
  })

  it('retains record toggle enabled state on pause so resume continues recording', async () => {
    const dialog = useDialogStore()
    dialog.status = 'idle'
    dialog.isRecordEnabled = true
    dialog.segments = [
      {
        id: '1',
        side: 'remote',
        startMs: 0,
        endMs: 100,
        text: 'Previous text',
        isFinal: true,
        translationState: 'idle',
      },
    ]

    const startSpy = vi
      .spyOn(dialog, 'start')
      .mockImplementation(async () => {})

    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    // Static dot, not pulsing
    expect(toggle.find('.dialog-record-dot').exists()).toBe(true)
    expect(toggle.find('.dialog-record-dot-pulsing').exists()).toBe(false)
    expect(toggle.text()).toContain(i18n.global.t('dialog.record'))

    const resumeButton = wrapper.find('.dialog-toolbar-run')
    expect(resumeButton.text()).toBe(i18n.global.t('dialog.resume'))
    await resumeButton.trigger('click')
    await flushPromises()

    expect(startSpy).toHaveBeenCalledWith({ isRecording: true })
  })

  it('allows toggling recording off while paused so resume continues without recording', async () => {
    const dialog = useDialogStore()
    dialog.status = 'idle'
    dialog.isRecordEnabled = true
    dialog.segments = [
      {
        id: '1',
        side: 'remote',
        startMs: 0,
        endMs: 100,
        text: 'Previous text',
        isFinal: true,
        translationState: 'idle',
      },
    ]

    const startSpy = vi
      .spyOn(dialog, 'start')
      .mockImplementation(async () => {})

    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    await toggle.trigger('click')
    await flushPromises()
    expect(dialog.isRecordEnabled).toBe(false)

    const resumeButton = wrapper.find('.dialog-toolbar-run')
    await resumeButton.trigger('click')
    await flushPromises()

    expect(startSpy).toHaveBeenCalledWith({ isRecording: false })
  })

  it('disables record toggle when history is not saved to disk', async () => {
    desktop.setUserConfig({
      editor: {
        ...DEFAULT_USER_CONFIG.editor,
        history: { ...DEFAULT_USER_CONFIG.editor.history, storage: 'memory' },
      },
    })
    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })

    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(toggle.attributes('title')).toBe(
      i18n.global.t('dialog.startRecordingNeedsHistory')
    )
  })

  it('clears transcript and resets record toggle when clicking Clear button', async () => {
    const dialog = useDialogStore()
    const clearSpy = vi
      .spyOn(dialog, 'clear')
      .mockImplementation(async () => {
        dialog.isRecordEnabled = false
        dialog.segments = []
      })
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
    dialog.isRecordEnabled = true

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
