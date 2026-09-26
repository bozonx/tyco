import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AudioWaveform from './AudioWaveform.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('AudioWaveform', () => {
  it('renders listening state with timer and waveform bars', () => {
    const wrapper = mount(AudioWaveform, {
      props: { durationMs: 45_000, level: 0.4, peak: 0.7 },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.find('[data-testid="audio-waveform"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('00:45')
    const bars = wrapper.findAll('.waveform-bar')
    expect(bars.length).toBe(32)
  })

  it('shows hours once a dictation runs past one', () => {
    const wrapper = mount(AudioWaveform, {
      props: { durationMs: 3_725_000 },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.text()).toContain('1:02:05')
  })

  it('renders transcribing state when isTranscribing is true', () => {
    const wrapper = mount(AudioWaveform, {
      props: { isTranscribing: true },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.find('.transcribing-state').exists()).toBe(true)
    expect(wrapper.find('.waveform-visualizer').exists()).toBe(false)
  })
})
