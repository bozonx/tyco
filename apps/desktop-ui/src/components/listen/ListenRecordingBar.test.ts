import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../lib/i18n'
import { createListenModel } from '../../lib/listen/listen-model'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ListenRecordingBar from './ListenRecordingBar.vue'

vi.mock('../quick/OverlayDragHandle.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('../voice/QuickModeSwitch.vue', () => ({
  default: { template: '<button class="mode-switch-stub" />' },
}))
vi.mock('../voice/AudioWaveform.vue', () => ({
  default: {
    name: 'AudioWaveform',
    props: ['icon', 'statusLabel', 'isTranscribing'],
    template: '<div class="waveform-stub" :data-icon="icon" />',
  },
}))
vi.mock('./ListenSourcePicker.vue', () => ({
  default: {
    name: 'ListenSourcePicker',
    props: ['source', 'appLabel', 'disabled'],
    emits: ['select'],
    template:
      '<button class="source-picker-stub" :data-label="appLabel" :disabled="disabled" />',
  },
}))

describe('ListenRecordingBar', () => {
  let desktop: TestDesktop

  beforeEach(async () => {
    desktop = await loadFakeDesktop({ mode: 'listen' }, 'quick')
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('uses volume icon and audio placeholder instead of microphone prompts', async () => {
    const model = createListenModel({
      startDictation: vi.fn(async () => undefined),
      finishDictation: vi.fn(async () => ''),
      cancelDictation: vi.fn(async () => undefined),
      switchSource: vi.fn(async () => undefined),
      saveTranscript: vi.fn(async () => undefined),
      describeError: (error) => String(error),
      onClose: vi.fn(),
    })
    await model.start({ kind: 'systemMix' })

    const wrapper = mount(ListenRecordingBar, {
      props: { model, audioLevel: 0, audioPeak: 0, recordingDurationMs: 0 },
      global: { plugins: [i18n, desktop.pinia] },
    })

    expect(wrapper.find('.waveform-stub').attributes('data-icon')).toBe(
      'mdi:volume-high'
    )
    expect(wrapper.text()).toContain(
      i18n.global.t('listen.listeningPlaceholder')
    )
    expect(wrapper.text()).not.toContain(i18n.global.t('menu.speakNow'))

    expect(
      wrapper
        .get('.listen-bar-title')
        .element.nextElementSibling?.classList.contains('listen-bar-info')
    ).toBe(true)
    expect(wrapper.get('.listen-bar-close .shortcut-label').text()).toBe(
      i18n.global.t('common.close')
    )
    expect(
      wrapper
        .get('.listen-bar-actions')
        .findAll('kbd')
        .map((key) => key.text())
    ).toEqual(['Shift', 'Space', 'Space', 'Enter'])
    expect(wrapper.get('.listen-bar-actions').text()).toContain(
      i18n.global.t('menu.actions')
    )

    // Selecting an application updates the waiting label dynamically
    const picker = wrapper.findComponent({ name: 'ListenSourcePicker' })
    picker.vm.$emit(
      'select',
      { kind: 'application', appId: 'firefox' },
      'Firefox'
    )
    await flushPromises()

    expect(wrapper.text()).toContain(
      i18n.global.t('listen.waitingFor', { app: 'Firefox' })
    )
    expect(wrapper.text()).toContain(i18n.global.t('listen.waitingPlaceholder'))

    wrapper.unmount()
  })
})
