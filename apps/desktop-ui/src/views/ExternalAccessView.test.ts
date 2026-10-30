import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import ExternalAccessView from './ExternalAccessView.vue'

const { answerAccess } = vi.hoisted(() => ({
  answerAccess: vi.fn(async (_jobId: string, _decision: string) => {}),
}))

vi.mock('../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}))
vi.mock('../stores/external-commands', () => ({
  useExternalCommandsStore: () => ({ answerAccess }),
}))
vi.mock('../stores/nav-panel', () => ({
  useNavPanelStore: () => ({ resetNavPanelState: vi.fn() }),
}))
vi.mock('../composables/use-overlay-nav', () => ({
  useOverlayNav: (
    options: () => { escLabel?: string; onEsc?: () => void }
  ) => ({ escLabel: options().escLabel, handleEsc: () => options().onEsc?.() }),
}))

let desktop: TestDesktop

const mountView = () =>
  mount(ExternalAccessView, {
    attachTo: document.body,
    global: { plugins: [desktop.pinia] },
  })

describe('ExternalAccessView.vue', () => {
  beforeEach(async () => {
    answerAccess.mockClear()
    desktop = await loadFakeDesktop({
      activation: {
        accessRequest: { jobId: 'job-1', commandName: 'Fix', replace: true },
      },
    })
  })

  afterEach(() => desktop.dispose())

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
    expect(answerAccess.mock.calls).toEqual([['job-1', 'always']])
  })

  it('denies on Esc', () => {
    const wrapper = mountView()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })
    )
    expect(answerAccess).toHaveBeenCalledWith('job-1', 'deny')
    wrapper.unmount()
  })

  it('ignores an Escape released without a keydown in this window', () => {
    const wrapper = mountView()
    window.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape' })
    )
    expect(answerAccess).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('denies a prompt closed without an answer', () => {
    mountView().unmount()
    expect(answerAccess.mock.calls).toEqual([['job-1', 'deny']])
  })
})
