import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VoiceRecognitionMenu from './VoiceRecognitionMenu.vue'

const mocks = vi.hoisted(() => ({
  startDictation: vi.fn().mockResolvedValue(undefined),
  finishDictation: vi.fn().mockResolvedValue('recognized voice'),
  cancelDictation: vi.fn().mockResolvedValue(undefined),
  shouldFormatRecognizedText: vi.fn().mockReturnValue(false),
  voiceCorrection: vi.fn(),
  toast: vi.fn(),
  toastText: vi.fn(),
}))

vi.mock('../../composables/use-call-ai', () => ({
  useCallAi: () => ({
    startDictation: mocks.startDictation,
    finishDictation: mocks.finishDictation,
    cancelDictation: mocks.cancelDictation,
    shouldFormatRecognizedText: mocks.shouldFormatRecognizedText,
    voiceCorrection: mocks.voiceCorrection,
  }),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toast: mocks.toast, toastText: mocks.toastText }),
}))

vi.mock('../../lib/desktop/client', () => ({
  desktopClient: {
    isAvailable: vi.fn().mockReturnValue(false),
    listen: vi.fn().mockResolvedValue(() => {}),
  },
}))

import {
  GlobalEvents,
  useGlobalEvents,
} from '../../composables/use-global-events'
import { useIpcStore } from '../../stores/ipc'
import { useHistoryStore } from '../../stores/history'
import { useMenuModalsStore } from '../../stores/menu-modals'

describe('VoiceRecognitionMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useIpcStore().params.isWindowShown = true
    vi.clearAllMocks()
    mocks.shouldFormatRecognizedText.mockReturnValue(false)
    mocks.finishDictation.mockResolvedValue('recognized voice')
  })

  it('renders chat action buttons (Finish, Cancel cross, Send button) when chat is true in bar mode', async () => {
    const wrapper = mount(VoiceRecognitionMenu, {
      props: { variant: 'bar', chat: true },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
          AudioWaveform: true,
          ShortcutButton: {
            props: ['keys', 'icon'],
            template: '<button class="shortcut-btn"><slot /></button>',
          },
          Button: {
            props: ['square', 'ghost', 'title', 'disabled'],
            template: '<button class="btn" :title="title"><slot /></button>',
          },
          Icon: true,
        },
      },
    })
    await flushPromises()

    const buttons = wrapper.findAll('button')
    // ShortcutButton (Finish), Button (Cancel), Button (Send)
    expect(buttons.length).toBe(3)

    const cancelBtn = wrapper.find('button[title="chat.voiceCancelHint"]')
    expect(cancelBtn.exists()).toBe(true)

    const sendBtn = wrapper.find('button[title="chat.voiceSendHint"]')
    expect(sendBtn.exists()).toBe(true)
  })

  it('triggers finish with submit on send button click', async () => {
    const wrapper = mount(VoiceRecognitionMenu, {
      props: { variant: 'bar', chat: true },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
          AudioWaveform: true,
          ShortcutButton: true,
          Button: {
            props: ['square', 'ghost', 'title', 'disabled'],
            template:
              '<button class="btn" :title="title" @click="$emit(\'click\')"><slot /></button>',
          },
          Icon: true,
        },
      },
    })
    await flushPromises()

    const sendBtn = wrapper.find('button[title="chat.voiceSendHint"]')
    await sendBtn.trigger('click')
    await flushPromises()

    expect(mocks.finishDictation).toHaveBeenCalled()
    expect(wrapper.emitted('corrected')).toBeTruthy()
    expect(wrapper.emitted('corrected')?.[0]?.[3]).toBe('submit')
  })

  it('triggers cancel on cross button click', async () => {
    const wrapper = mount(VoiceRecognitionMenu, {
      props: { variant: 'bar', chat: true },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
          AudioWaveform: true,
          ShortcutButton: true,
          Button: {
            props: ['square', 'ghost', 'title', 'disabled'],
            template:
              '<button class="btn" :title="title" @click="$emit(\'click\')"><slot /></button>',
          },
          Icon: true,
        },
      },
    })
    await flushPromises()

    const cancelBtn = wrapper.find('button[title="chat.voiceCancelHint"]')
    await cancelBtn.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('cancelled')).toBeTruthy()
  })

  it('triggers finish with submit on Ctrl+Enter keydown', async () => {
    const wrapper = mount(VoiceRecognitionMenu, {
      props: { variant: 'bar', chat: true },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
          AudioWaveform: true,
          ShortcutButton: true,
          Button: true,
          Icon: true,
        },
      },
    })
    await flushPromises()

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'Enter',
        ctrlKey: true,
        bubbles: true,
      })
    )
    await flushPromises()

    expect(mocks.finishDictation).toHaveBeenCalled()
    expect(wrapper.emitted('corrected')).toBeTruthy()
    expect(wrapper.emitted('corrected')?.[0]?.[3]).toBe('submit')
  })
  describe('quick voice chat keys', () => {
    const mountQuickSend = () =>
      mount(VoiceRecognitionMenu, {
        props: { variant: 'sheet', quickSend: true },
        global: {
          stubs: {
            ActionOverlayLayout: {
              template:
                '<div><slot name="preview" /><slot name="actions" /></div>',
            },
            LiveTranscript: {
              props: ['committed', 'draft', 'prefix', 'suffix', 'placeholder'],
              template: '<div />',
            },
            AudioWaveform: true,
            TextPreview: true,
            ShortcutButton: true,
            Icon: true,
          },
        },
      })

    const keyUp = async (init: KeyboardEventInit) => {
      const { globalEvents } = useGlobalEvents()
      globalEvents.emit(GlobalEvents.KEY_UP, new KeyboardEvent('keyup', init))
      await flushPromises()
    }

    it.each([
      [{ code: 'Enter' }, 'submit'],
      [{ code: 'Space' }, 'submit'],
      [{ code: 'Enter', shiftKey: true }, 'insert'],
      [{ code: 'Tab' }, 'next'],
    ] as const)('finishes %o with %s', async (init, intent) => {
      const wrapper = mountQuickSend()
      await flushPromises()

      await keyUp(init)

      expect(wrapper.emitted('corrected')?.[0]?.[3]).toBe(intent)
      wrapper.unmount()
    })
  })

  const mountChat = () =>
    mount(VoiceRecognitionMenu, {
      props: { variant: 'bar', chat: true },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix', 'placeholder'],
            template: '<div />',
          },
          AudioWaveform: true,
          ShortcutButton: true,
          Icon: true,
          Button: {
            props: ['title'],
            template:
              '<button :title="title" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    })

  it('does not submit a transcript returned after the menu unmounts', async () => {
    let resolve!: (text: string) => void
    mocks.finishDictation.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    const wrapper = mountChat()
    await flushPromises()
    await wrapper.find('button[title="chat.voiceSendHint"]').trigger('click')
    await flushPromises()
    wrapper.unmount()
    resolve('Late transcript')
    await flushPromises()
    expect(wrapper.emitted('corrected')).toBeUndefined()
  })

  it('does not save a partial correction after cancellation or clear a new operation', async () => {
    let resolve!: (text: string) => void
    mocks.shouldFormatRecognizedText.mockReturnValue(true)
    mocks.voiceCorrection.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    const history = useHistoryStore()
    vi.spyOn(history, 'saveSource').mockResolvedValue('voice-source')
    const save = vi.spyOn(history, 'saveSourceResult').mockResolvedValue()
    const wrapper = mountChat()
    await flushPromises()
    await wrapper.find('button[title="chat.voiceSendHint"]').trigger('click')
    await flushPromises()
    const menu = useMenuModalsStore()
    menu.cancelPending()
    menu.setPendingModal({ label: 'New operation' })
    resolve('Partial correction')
    await flushPromises()
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.emitted('corrected')).toBeUndefined()
    expect(wrapper.emitted('cancelled')).toHaveLength(1)
    expect(menu.pendingModal).toEqual({ label: 'New operation' })
    wrapper.unmount()
  })
})
