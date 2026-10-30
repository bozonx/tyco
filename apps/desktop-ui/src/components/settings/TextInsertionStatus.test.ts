import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import TextInsertionStatus from './TextInsertionStatus.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('TextInsertionStatus.vue', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop()
  })

  afterEach(() => desktop.dispose())

  const mountStatus = () =>
    mount(TextInsertionStatus, { global: { plugins: [desktop.pinia] } })

  it('checks on mount and shows both parts of the status', async () => {
    desktop.backend.handle('get_text_insertion_status', () => ({
      keys: 'unavailable',
      problem: 'ydotooldNotRunning',
      detail: 'ydotoold is not running',
      target: 'focusReturn',
    }))
    const wrapper = mountStatus()
    await flushPromises()

    expect(desktop.backend.callsOf('get_text_insertion_status')).toHaveLength(1)
    expect(wrapper.text()).toContain(
      'settings.textInsertion.ydotooldNotRunning'
    )
    expect(wrapper.text()).toContain('ydotoold is not running')
    expect(wrapper.text()).toContain('settings.textInsertion.targetFocusReturn')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('asks for keyboard control when the portal needs permission', async () => {
    let isGranted = false
    desktop.backend.handle('get_text_insertion_status', () => ({
      keySender: 'portal',
      keys: isGranted ? 'ready' : 'needsPermission',
      target: 'tracked',
    }))
    desktop.backend.handle('request_text_insertion_permission', () => {
      isGranted = true
      return { keySender: 'portal', keys: 'ready', target: 'tracked' }
    })
    const wrapper = mountStatus()
    await flushPromises()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(
      desktop.backend.callsOf('request_text_insertion_permission')
    ).toHaveLength(1)
    expect(wrapper.text()).toContain('settings.textInsertion.keysReadyPortal')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
