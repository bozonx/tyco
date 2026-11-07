import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeDesktop } from '../../test/install-fake-desktop'
import ContextPreview from './ContextPreview.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ContextPreview', () => {
  beforeEach(() => {
    installFakeDesktop()
  })

  it('renders text preview and action buttons when enabled', async () => {
    const wrapper = mount(ContextPreview, {
      props: { text: 'Sample context text', disabled: false },
    })

    expect(wrapper.text()).toContain('Sample context text')
    expect(wrapper.find('.context-disabled-banner').exists()).toBe(false)

    // Remove button
    const removeBtn = wrapper.find('button[aria-label="action.removeContext"]')
    expect(removeBtn.exists()).toBe(true)
    await removeBtn.trigger('click')

    expect(wrapper.emitted('update:disabled')?.[0]).toEqual([true])
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })

  it('renders disabled banner and restore button when disabled', async () => {
    const wrapper = mount(ContextPreview, {
      props: { text: 'Sample context text', disabled: true },
    })

    expect(wrapper.find('.context-disabled-banner').exists()).toBe(true)
    expect(wrapper.text()).toContain('menu.contextRemoved')

    const restoreBtn = wrapper.findComponent({ name: 'Button' })
    expect(restoreBtn.exists()).toBe(true)
    await restoreBtn.trigger('click')

    expect(wrapper.emitted('update:disabled')?.[0]).toEqual([false])
    expect(wrapper.emitted('restore')).toHaveLength(1)
  })

  it('handles diff mode when oldText is provided', () => {
    const wrapper = mount(ContextPreview, {
      props: {
        text: 'New text',
        oldText: 'Old text',
        diffMode: 'split',
        disabled: false,
      },
    })

    expect(wrapper.findComponent({ name: 'Diff' }).exists()).toBe(true)
  })
})
