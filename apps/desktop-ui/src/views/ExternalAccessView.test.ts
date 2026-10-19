import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import ExternalAccessView from './ExternalAccessView.vue'

const { call, desktopState } = vi.hoisted(() => ({
  call: vi.fn(async () => ({ success: true, result: undefined })),
  desktopState: {
    accessRequest: null as null | {
      jobId: string
      commandName: string
      replace: boolean
    },
  },
}))
const reactiveParams = reactive(desktopState)

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}))
vi.mock('../stores/ipc', () => ({ useIpcStore: () => ({ call }) }))
vi.mock('../stores/desktop', async () => {
  const { mockDesktopStore } = await import('../test/desktop-store')
  return { useDesktopStore: () => mockDesktopStore(() => reactiveParams) }
})
vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => ({ resetNavPanelState: vi.fn() }),
}))
vi.mock('../composables/use-overlay-nav', () => ({
  useOverlayNav: (
    options: () => { escLabel?: string; onEsc?: () => void }
  ) => ({ escLabel: options().escLabel, handleEsc: () => options().onEsc?.() }),
}))

const mountView = () => mount(ExternalAccessView, { attachTo: document.body })

describe('ExternalAccessView.vue', () => {
  beforeEach(() => {
    call.mockClear()
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
    expect(call.mock.calls).toEqual([
      ['answer_external_access', { jobId: 'job-1', decision: 'always' }],
    ])
  })

  it('denies on Esc', () => {
    const wrapper = mountView()
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }))
    expect(call).toHaveBeenCalledWith('answer_external_access', {
      jobId: 'job-1',
      decision: 'deny',
    })
    wrapper.unmount()
  })

  it('denies a prompt closed without an answer', () => {
    mountView().unmount()
    expect(call.mock.calls).toEqual([
      ['answer_external_access', { jobId: 'job-1', decision: 'deny' }],
    ])
  })
})
