import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../lib/i18n'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import ListenView from './ListenView.vue'
import { DEFAULT_USER_CONFIG } from '@tyco/shared'

const dictation = vi.hoisted(() => ({
  startDictation: vi.fn(),
  finishDictation: vi.fn(),
  cancelDictation: vi.fn(),
  switchSource: vi.fn(),
}))
vi.mock('../composables/use-dictation-actions', () => ({
  useDictationActions: () => dictation,
}))
vi.mock('../components/listen/ListenRecordingBar.vue', () => ({
  default: { props: ['model'], template: '<div class="listen-bar-stub" />' },
}))
vi.mock('../components/menu/InsertMenu.vue', () => ({
  default: {
    props: ['text', 'allowInsertButton'],
    template: '<div class="insert-menu-stub" :data-text="text" />',
  },
}))
vi.mock('../components/voice/QuickModeSwitch.vue', () => ({
  default: { template: '<button class="mode-switch-stub" />' },
}))
vi.mock('../components/quick/OverlayDragHandle.vue', () => ({
  default: { template: '<div />' },
}))

let desktop: TestDesktop

const mountView = () =>
  mount(ListenView, {
    global: { plugins: [i18n, desktop.pinia] },
    attachTo: document.body,
  })

const pressEnter = async () => {
  document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter' }))
  await flushPromises()
}

describe('ListenView', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    dictation.startDictation.mockResolvedValue(undefined)
    dictation.finishDictation.mockResolvedValue('Voice message text')
    dictation.cancelDictation.mockResolvedValue(undefined)
    desktop = await loadFakeDesktop({ mode: 'listen' }, 'quick')
  })

  it('records the whole sound by default, in a bar', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(dictation.startDictation).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: 'systemMix' } })
    )
    expect(wrapper.find('.listen-bar-stub').exists()).toBe(true)
    expect(wrapper.emitted('result-shown')?.at(-1)).toEqual([false])
    wrapper.unmount()
  })

  it('starts with the app the hotkey is set to record', async () => {
    desktop = await loadFakeDesktop(
      {
        mode: 'listen',
        userConfig: {
          ...DEFAULT_USER_CONFIG,
          stt: { ...DEFAULT_USER_CONFIG.stt, listenAppId: 'telegram-desktop' },
        },
      },
      'quick'
    )
    const wrapper = mountView()
    await flushPromises()

    expect(dictation.startDictation).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: 'application', appId: 'telegram-desktop' },
      })
    )
    wrapper.unmount()
  })

  it('offers the transcript to act on instead of inserting it', async () => {
    const wrapper = mountView()
    await flushPromises()
    await pressEnter()

    const menu = wrapper.find('.insert-menu-stub')
    expect(menu.attributes('data-text')).toBe('Voice message text')
    expect(wrapper.emitted('result-shown')?.at(-1)).toEqual([true])
    expect(
      desktop.backend.calls.some((call) => call.command === 'paste_text')
    ).toBe(false)
    wrapper.unmount()
  })

  it('tells that nothing was heard and offers to retry', async () => {
    dictation.finishDictation.mockResolvedValue('')
    const wrapper = mountView()
    await flushPromises()
    await pressEnter()

    expect(wrapper.find('.insert-menu-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain(i18n.global.t('listen.nothingRecognized'))
    const retry = wrapper
      .findAll('button')
      .find((button) => button.text() === i18n.global.t('listen.retry'))
    await retry!.trigger('click')
    await flushPromises()
    expect(dictation.startDictation).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
