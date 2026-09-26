import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import LiveTranscript from './LiveTranscript.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('LiveTranscript', () => {
  it('renders placeholder when no text is present', () => {
    const wrapper = mount(LiveTranscript, {
      props: { committed: '', draft: '' },
    })

    expect(wrapper.find('.live-transcript-placeholder').exists()).toBe(true)
    expect(wrapper.text()).toContain('menu.speakNow')
    expect(wrapper.find('.placeholder-cursor').exists()).toBe(true)
  })

  it('renders custom placeholder when provided', () => {
    const wrapper = mount(LiveTranscript, {
      props: { committed: '', draft: '', placeholder: 'Custom hint...' },
    })

    expect(wrapper.text()).toContain('Custom hint...')
  })

  it('renders committed and draft text when available', () => {
    const wrapper = mount(LiveTranscript, {
      props: { committed: 'Hello world', draft: 'next words' },
    })

    expect(wrapper.find('.live-transcript-placeholder').exists()).toBe(false)
    expect(wrapper.find('.live-transcript-content').exists()).toBe(true)
    expect(wrapper.text()).toContain('Hello world')
    expect(wrapper.text()).toContain('next words')
    expect(wrapper.find('.live-transcript-cursor').exists()).toBe(true)
  })
})
