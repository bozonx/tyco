import type { TextInsertionStatus as Status } from '@tyco/shared'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TextInsertionStatus from './TextInsertionStatus.vue'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))

vi.mock('../../stores/ipc', () => ({
  useIpcStore: () => ({ call: mocks.call }),
}))
vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const status = (value: Status) => ({ success: true, result: value })

describe('TextInsertionStatus.vue', () => {
  beforeEach(() => {
    mocks.call.mockReset()
  })

  it('checks on mount and shows both parts of the status', async () => {
    mocks.call.mockResolvedValue(
      status({
        keys: 'unavailable',
        problem: 'ydotooldNotRunning',
        detail: 'ydotoold is not running',
        target: 'focusReturn',
      })
    )
    const wrapper = mount(TextInsertionStatus)
    await flushPromises()

    expect(mocks.call).toHaveBeenCalledWith('get_text_insertion_status')
    expect(wrapper.text()).toContain(
      'settings.textInsertion.ydotooldNotRunning'
    )
    expect(wrapper.text()).toContain('ydotoold is not running')
    expect(wrapper.text()).toContain('settings.textInsertion.targetFocusReturn')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('asks for keyboard control when the portal needs permission', async () => {
    mocks.call
      .mockResolvedValueOnce(
        status({
          keySender: 'portal',
          keys: 'needsPermission',
          target: 'tracked',
        })
      )
      .mockResolvedValueOnce(
        status({ keySender: 'portal', keys: 'ready', target: 'tracked' })
      )
    const wrapper = mount(TextInsertionStatus)
    await flushPromises()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(mocks.call).toHaveBeenLastCalledWith(
      'request_text_insertion_permission'
    )
    expect(wrapper.text()).toContain('settings.textInsertion.keysReadyPortal')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
