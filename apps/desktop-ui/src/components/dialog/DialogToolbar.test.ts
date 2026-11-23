import { DEFAULT_USER_CONFIG } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useDesktopStore } from '../../stores/desktop'
import { useDialogStatusStore } from '../../stores/dialog-status'
import { useDialogStore } from '../../stores/dialog'
import DialogToolbar from './DialogToolbar.vue'
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

  it('renders record toggle button with aria-pressed false by default and explanatory tooltip', () => {
    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
    })
    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.text()).toContain(i18n.global.t('dialog.record'))
    expect(toggle.attributes('title')).toBe(
      i18n.global.t('dialog.recordToggleEnableHint')
    )

    const runBtn = wrapper.find('.dialog-toolbar-run')
    expect(runBtn.attributes('title')).toBe(
      i18n.global.t('dialog.listenTooltip')
    )
  })

  it('enables recording immediately and shows recording notice popover when not yet acknowledged', async () => {
    desktop.setUserConfig({
      dialog: {
        ...DEFAULT_USER_CONFIG.dialog,
        isEnabled: true,
        isRecordingNoticeAcknowledged: false,
      },
    })
    const wrapper = mount(DialogToolbar, {
      global: { plugins: [i18n, desktop.pinia] },
      attachTo: document.body,
    })
    const toggle = wrapper.find('.dialog-toolbar-record-toggle')
    await toggle.trigger('click')
    await flushPromises()

    const dialog = useDialogStore()
    expect(dialog.isRecordEnabled).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('true')

    const popover = document.body.querySelector(
      '.dialog-recording-notice-popover'
    )
    expect(popover).not.toBeNull()
    expect(popover?.textContent).toContain(
      i18n.global.t('dialog.recordingNoticeMessage')
    )

    // Confirm notice in popover
    const confirmButton = popover?.querySelector(
      '.dialog-recording-notice-actions button'
    ) as HTMLButtonElement | null
    expect(confirmButton).not.toBeNull()
    confirmButton?.click()
    await flushPromises()

    const desktopStore = useDesktopStore()
    expect(desktopStore.userConfig.dialog.isRecordingNoticeAcknowledged).toBe(
      true
    )
    expect(
      document.body.querySelector('.dialog-recording-notice-popover')
    ).toBeNull()
    wrapper.unmount()
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
    expect(toggle.attributes('title')).toBe(
      i18n.global.t('dialog.recordStopToChangeHint')
    )
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

    expect(toggle.attributes('title')).toBe(
      i18n.global.t('dialog.recordToggleDisableHint')
    )

    const resumeButton = wrapper.find('.dialog-toolbar-run')
    expect(resumeButton.text()).toBe(i18n.global.t('dialog.resume'))
    expect(resumeButton.attributes('title')).toBe(
      i18n.global.t('dialog.resumeTooltipWithRecord')
    )
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
        history: { ...DEFAULT_USER_CONFIG.editor.history, storage: 'off' },
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
    const clearSpy = vi.spyOn(dialog, 'clear').mockImplementation(async () => {
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

  it('updates tray recording state when recording starts and stops', async () => {
    const dialog = useDialogStore()
    const dialogStatus = useDialogStatusStore()

    expect(dialogStatus.isRecording).toBe(false)

    dialog.status = 'running'
    dialog.recording = { file: 'test.opus', startedAtMs: Date.now() }
    await flushPromises()

    expect(dialogStatus.isRecording).toBe(true)
    const recordingCalls = desktop.backend.calls.filter(
      (call) => call.command === 'set_tray_recording'
    )
    expect(recordingCalls.length).toBeGreaterThan(0)
    expect(recordingCalls.at(-1)?.args).toEqual({
      isRecording: true,
      tooltipLabel: i18n.global.t('tray.recordingTooltip'),
    })

    dialog.recording = undefined
    await flushPromises()

    expect(dialogStatus.isRecording).toBe(false)
    const stoppedCalls = desktop.backend.calls.filter(
      (call) => call.command === 'set_tray_recording'
    )
    expect(stoppedCalls.at(-1)?.args).toEqual({
      isRecording: false,
      tooltipLabel: i18n.global.t('tray.tooltip'),
    })
  })
})
