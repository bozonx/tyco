import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useDialogStore } from '../../stores/dialog'
import DialogRecordingPlayer from './DialogRecordingPlayer.vue'

describe('DialogRecordingPlayer.vue', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop()
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('renders recording file name, open folder button, and play button', () => {
    const wrapper = mount(DialogRecordingPlayer, {
      props: { file: '2026-11-23 12-00-00 a1b2c3.opus' },
      global: { plugins: [i18n, desktop.pinia] },
    })

    expect(wrapper.text()).toContain('2026-11-23 12-00-00 a1b2c3.opus')
    expect(wrapper.find('.dialog-recording-name').attributes('title')).toBe(
      '2026-11-23 12-00-00 a1b2c3.opus'
    )
    const buttons = wrapper.findAll('button')
    // Open folder button & Play button
    expect(buttons).toHaveLength(2)
  })

  it('disables play button when dialog is active', async () => {
    const dialog = useDialogStore()
    dialog.status = 'running'

    const wrapper = mount(DialogRecordingPlayer, {
      props: { file: 'test.opus' },
      global: { plugins: [i18n, desktop.pinia] },
    })

    const playBtn = wrapper.findAll('button')[1]
    expect(playBtn.attributes('disabled')).toBeDefined()
    expect(playBtn.attributes('aria-label')).toBe(
      i18n.global.t('history.playRecordingWhileCapturing')
    )
  })

  it('calls show_dialog_recording when clicking the open folder button', async () => {
    let shownFile: string | undefined
    desktop.backend.handle('show_dialog_recording', (args) => {
      shownFile = (args as { file: string }).file
      return undefined
    })

    const wrapper = mount(DialogRecordingPlayer, {
      props: { file: 'call.opus' },
      global: { plugins: [i18n, desktop.pinia] },
    })

    const folderBtn = wrapper.findAll('button')[0]
    await folderBtn.trigger('click')
    await flushPromises()

    expect(shownFile).toBe('call.opus')
  })

  it('starts playback when play button is clicked', async () => {
    desktop.backend.handle('read_dialog_recording', () => new ArrayBuffer(8))

    const wrapper = mount(DialogRecordingPlayer, {
      props: { file: 'call.opus' },
      global: { plugins: [i18n, desktop.pinia] },
    })

    const playBtn = wrapper.findAll('button')[1]
    await playBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('audio').exists()).toBe(true)
    expect(wrapper.find('.dialog-player-seek').exists()).toBe(true)
  })
})
