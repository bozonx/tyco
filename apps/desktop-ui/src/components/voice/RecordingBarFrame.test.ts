import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../../lib/i18n'
import { loadFakeDesktop } from '../../test/install-fake-desktop'
import RecordingBarFrame from './RecordingBarFrame.vue'

const cleanups: (() => void)[] = []
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup())
)

describe('RecordingBarFrame', () => {
  it('remembers collapse independently for voice and listening', async () => {
    const desktop = await loadFakeDesktop()
    cleanups.push(() => desktop.dispose())
    const wrapper = mount(RecordingBarFrame, {
      props: { label: 'Recording', collapseMode: 'voice' },
      global: { plugins: [desktop.pinia, i18n] },
      slots: { default: '<button class="finish">Finish</button>' },
    })
    cleanups.push(() => wrapper.unmount())
    await wrapper.get('.recording-collapse-button').trigger('click')
    await flushPromises()
    expect(wrapper.classes()).toContain('is-collapsed')
    expect(desktop.backend.userConfig.quickWindow.isVoiceCollapsed).toBe(true)
    expect(desktop.backend.userConfig.quickWindow.isListenCollapsed).toBe(false)
    expect(wrapper.find('.finish').exists()).toBe(true)
    await wrapper.setProps({ collapseMode: 'listen' })
    expect(wrapper.classes()).not.toContain('is-collapsed')
    await wrapper.get('.recording-collapse-button').trigger('click')
    await flushPromises()
    expect(desktop.backend.userConfig.quickWindow.isListenCollapsed).toBe(true)
    await wrapper.setProps({ collapseMode: 'voice' })
    expect(wrapper.classes()).toContain('is-collapsed')
  })
})
