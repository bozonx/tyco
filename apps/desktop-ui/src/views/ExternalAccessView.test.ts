import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import ExternalAccessView from './ExternalAccessView.vue'

const { callFunction, params } = vi.hoisted(() => ({
  callFunction: vi.fn(async () => ({ success: true, result: undefined })),
  params: {
    accessRequest: null as null | {
      jobId: string
      commandName: string
      replace: boolean
    },
  },
}))
const reactiveParams = reactive(params)

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}))
vi.mock('../stores/ipc', () => ({
  useIpcStore: () => ({ callFunction, params: reactiveParams }),
}))
vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => ({ resetNavParams: vi.fn() }),
}))
vi.mock('../composables/use-overlay-nav', () => ({
  useOverlayNav: (
    options: () => { escLabel?: string; onEsc?: () => void }
  ) => ({ escLabel: options().escLabel, handleEsc: () => options().onEsc?.() }),
}))

const mountView = () => mount(ExternalAccessView, { attachTo: document.body })

describe('ExternalAccessView.vue', () => {
  beforeEach(() => {
    callFunction.mockClear()
    reactiveParams.accessRequest = {
      jobId: 'job-1',
      commandName: 'Fix',
      replace: true,
    }
  })

  it('names the command and what happens to the selection', () => {
    const wrapper = mountView()
    expect(wrapper.text()).toContain('externalAccess.askReplace:Fix')
    wrapper.unmount()
  })

  it('sends the chosen answer once', async () => {
    const wrapper = mountView()
    await wrapper.find('.access-allow-always').trigger('click')
    await wrapper.find('.access-allow-once').trigger('click')
    wrapper.unmount()
    expect(callFunction.mock.calls).toEqual([
      ['answerExternalAccess', ['job-1', 'always']],
    ])
  })

  it('denies on Esc', () => {
    const wrapper = mountView()
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
    expect(callFunction).toHaveBeenCalledWith('answerExternalAccess', [
      'job-1',
      'deny',
    ])
    wrapper.unmount()
  })

  it('denies a prompt closed without an answer', () => {
    mountView().unmount()
    expect(callFunction.mock.calls).toEqual([
      ['answerExternalAccess', ['job-1', 'deny']],
    ])
  })
})
