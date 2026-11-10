import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../lib/i18n'
import { DictationError } from '../lib/stt/dictation-error'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useListenReplyStore } from '../stores/listen-reply'
import { useVoiceResultStore } from '../stores/voice-result'
import { loadFakeDesktop, type TestDesktop } from '../test/install-fake-desktop'
import ListenView from './ListenView.vue'
import { DEFAULT_USER_CONFIG, DESKTOP_EVENTS } from '@tyco/shared'

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
  default: {
    name: 'QuickModeSwitch',
    template: '<button class="mode-switch-stub" />',
  },
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

const pressEnter = async (target: EventTarget = document) => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Enter', bubbles: true })
  )
  target.dispatchEvent(
    new KeyboardEvent('keyup', { code: 'Enter', bubbles: true })
  )
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

  it('ignores Enter inside buttons or menus and stray Enter keyup', async () => {
    const wrapper = mountView()
    await flushPromises()

    // Stray keyup without prior keydown must not stop recording
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter' }))
    await flushPromises()
    expect(dictation.finishDictation).not.toHaveBeenCalled()

    const button = document.createElement('button')
    document.body.appendChild(button)
    try {
      await pressEnter(button)
      expect(dictation.finishDictation).not.toHaveBeenCalled()
    } finally {
      button.remove()
    }

    await pressEnter()
    expect(dictation.finishDictation).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('resets stale voice result when replying by voice and closes open modals on close', async () => {
    desktop.backend.handle('switch_quick_mode', () => undefined)
    desktop.backend.handle('hide_window', () => undefined)
    const voiceResult = useVoiceResultStore()
    voiceResult.step.showResult('Old voice result', '')
    expect(voiceResult.step.isInsertMenuVisible.value).toBe(true)

    const wrapper = mountView()
    await flushPromises()
    await pressEnter()

    const replyBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes(i18n.global.t('listen.replyByVoice')))
    expect(replyBtn).toBeDefined()
    await replyBtn!.trigger('click')
    await flushPromises()

    expect(voiceResult.step.isInsertMenuVisible.value).toBe(false)
    expect(desktop.backend.callsOf('switch_quick_mode')).toContainEqual(
      expect.objectContaining({ mode: 'voice' })
    )
    wrapper.unmount()

    // Closing via repeat hotkey with an open modal cancels the modal before hiding
    const modals = useMenuModalsStore()
    const wrapper2 = mountView()
    await flushPromises()
    await pressEnter()
    modals.nextModal(MenuModals.TRANSLATE, { text: 'Voice message text' })
    expect(modals.hasOpenModal).toBe(true)

    await desktop.emit(
      DESKTOP_EVENTS.VOICE_FINISH,
      desktop.backend.activation.activationId
    )
    await flushPromises()
    expect(modals.hasOpenModal).toBe(false)
    expect(desktop.backend.callsOf('hide_window')).toHaveLength(1)
    wrapper2.unmount()
  })

  it('keeps the transcript visible while a mode switch is pending', async () => {
    let complete!: () => void
    desktop.backend.handle(
      'switch_quick_mode',
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const wrapper = mountView()
    try {
      await flushPromises()
      await pressEnter()
      wrapper.findComponent({ name: 'QuickModeSwitch' }).vm.$emit('switch')
      await flushPromises()
      expect(wrapper.find('.insert-menu-stub').attributes('data-text')).toBe(
        'Voice message text'
      )
      complete()
      await flushPromises()
    } finally {
      wrapper.unmount()
    }
  })

  it('publishes reply context only after the native mode switch succeeds', async () => {
    let complete!: () => void
    desktop.backend.handle(
      'switch_quick_mode',
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        })
    )
    const nextId = desktop.backend.activation.activationId + 1
    const wrapper = mountView()
    try {
      await flushPromises()
      await pressEnter()
      const button = wrapper
        .findAll('button')
        .find((item) =>
          item.text().includes(i18n.global.t('listen.replyByVoice'))
        )!
      await button.trigger('click')
      await flushPromises()
      const reply = useListenReplyStore()
      expect(reply.contextFor(nextId)).toBeUndefined()
      complete()
      await flushPromises()
      expect(reply.contextFor(nextId)).toBe('Voice message text')
      expect(reply.contextFor(nextId + 1)).toBeUndefined()
    } finally {
      wrapper.unmount()
    }
  })

  it('offers Open settings button when starting fails due to a missing key', async () => {
    const activateMode = vi.fn()
    desktop.backend.handle('activate_mode', activateMode)
    desktop.backend.handle('hide_window', () => undefined)
    dictation.startDictation.mockRejectedValueOnce(
      new DictationError('missingKey', 'Missing Deepgram key')
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Missing Deepgram key')
    const settingsBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes(i18n.global.t('common.openSettings')))
    expect(settingsBtn).toBeDefined()
    await settingsBtn!.trigger('click')
    await flushPromises()

    expect(activateMode).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'config', settingsTab: 'stt' })
    )
    wrapper.unmount()
  })
})
