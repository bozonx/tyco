import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import WriteLivePreview from './WriteLivePreview.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('WriteLivePreview.vue', () => {
  it('renders loading state without text', () => {
    const wrapper = mount(WriteLivePreview, {
      props: { status: 'loading', text: '', originalText: 'Hell' },
      global: { stubs: { AppIcon: true } },
    })

    expect(wrapper.classes()).toContain('status-loading')
    expect(wrapper.text()).toContain('write.liveCorrecting')
  })

  it('renders corrected text when ready and changed', async () => {
    const wrapper = mount(WriteLivePreview, {
      props: {
        status: 'ready',
        text: 'Hello, world!',
        originalText: 'Hello world',
      },
      global: { stubs: { AppIcon: true } },
    })

    expect(wrapper.classes()).toContain('status-ready')
    expect(wrapper.classes()).toContain('is-changed')
    expect(wrapper.text()).toContain('Hello, world!')
    expect(wrapper.text()).toContain('write.clickToApply')

    await wrapper.trigger('click')
    expect(wrapper.emitted('accept')).toEqual([['Hello, world!']])
  })

  it('indicates already corrected when text matches original', async () => {
    const wrapper = mount(WriteLivePreview, {
      props: {
        status: 'ready',
        text: 'Clean text',
        originalText: 'Clean text',
      },
      global: { stubs: { AppIcon: true } },
    })

    expect(wrapper.classes()).not.toContain('is-changed')
    expect(wrapper.classes()).not.toContain('is-clickable')
    expect(wrapper.text()).toContain('write.alreadyCorrected')

    await wrapper.trigger('click')
    expect(wrapper.emitted('accept')).toBeUndefined()
  })

  it('does not emit accept while loading a newer correction', async () => {
    const wrapper = mount(WriteLivePreview, {
      props: {
        status: 'loading',
        text: 'Stale correction',
        originalText: 'Stale correction plus more text',
      },
      global: { stubs: { AppIcon: true } },
    })

    expect(wrapper.classes()).not.toContain('is-clickable')
    await wrapper.trigger('click')
    expect(wrapper.emitted('accept')).toBeUndefined()
  })

  it('renders error state when request fails', async () => {
    const wrapper = mount(WriteLivePreview, {
      props: { status: 'error', text: '', originalText: 'Broken input' },
      global: { stubs: { AppIcon: true } },
    })

    expect(wrapper.classes()).toContain('status-error')
    expect(wrapper.text()).toContain('write.liveCorrectionFailed')
    expect(wrapper.text()).toContain('write.liveCorrectionFailedHint')
    expect(wrapper.classes()).not.toContain('is-clickable')

    await wrapper.trigger('click')
    expect(wrapper.emitted('accept')).toBeUndefined()
  })

  it('renders stale text with error indication when error happens after a successful run', () => {
    const wrapper = mount(WriteLivePreview, {
      props: {
        status: 'error',
        text: 'Previous correction',
        originalText: 'Previous correction typed further',
      },
      global: { stubs: { AppIcon: true } },
    })

    expect(wrapper.classes()).toContain('status-error')
    expect(wrapper.text()).toContain('write.liveCorrectionFailed')
    expect(wrapper.text()).toContain('Previous correction')
    expect(wrapper.find('.write-live-text.is-stale').exists()).toBe(true)
    expect(wrapper.classes()).not.toContain('is-clickable')
  })
})
