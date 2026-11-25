import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

  it('renders recording file name and play button', () => {
    const wrapper = mount(DialogRecordingPlayer, {
      props: {
        dialogId: '2026-11-23_12-00-00_a1b2c3',
        file: '2026-11-23 12-00-00 a1b2c3.opus',
      },
      global: { plugins: [i18n, desktop.pinia] },
    })

    expect(wrapper.text()).toContain('2026-11-23 12-00-00 a1b2c3.opus')
    expect(wrapper.find('.history-file-name').attributes('title')).toBe(
      '2026-11-23 12-00-00 a1b2c3.opus'
    )
    const playBtn = wrapper.find('button')
    expect(playBtn.attributes('aria-label')).toBe(
      i18n.global.t('history.playRecording')
    )
  })

  it('disables play button when dialog is active', async () => {
    const dialog = useDialogStore()
    dialog.status = 'running'

    const wrapper = mount(DialogRecordingPlayer, {
      props: { dialogId: '2026-11-23_12-00-00_a1b2c3', file: 'test.opus' },
      global: { plugins: [i18n, desktop.pinia] },
    })

    const playBtn = wrapper.find('button')
    expect(playBtn.attributes('disabled')).toBeDefined()
    expect(playBtn.attributes('aria-label')).toBe(
      i18n.global.t('history.playRecordingWhileCapturing')
    )
  })

  it('starts playback when play button is clicked and shows seekbar and speeds', async () => {
    desktop.backend.handle('read_dialog_recording', () => new ArrayBuffer(8))

    const wrapper = mount(DialogRecordingPlayer, {
      props: { dialogId: '2026-11-23_12-00-00_a1b2c3', file: 'call.opus' },
      global: { plugins: [i18n, desktop.pinia] },
    })

    const playBtn = wrapper.find('button')
    await playBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('audio').exists()).toBe(true)
    expect(wrapper.find('.history-player-seek').exists()).toBe(true)
    const options = wrapper
      .findAll('.history-player-speed .option-label')
      .map((option) => option.text())
    expect(options).toEqual(['1×', '1.5×', '2×'])
  })
})
