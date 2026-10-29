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
  stylingPrompt: vi.fn(),
  toastKey: vi.fn(),
  toastText: vi.fn(),
}))

vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({
    actions: {
      voiceCorrection: mocks.voiceCorrection,
      stylingPrompt: mocks.stylingPrompt,
    },
  }),
}))

vi.mock('../../composables/use-dictation-actions', () => ({
  useDictationActions: () => ({
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
  default: () => ({ toastKey: mocks.toastKey, toastText: mocks.toastText }),
}))

vi.mock('../../lib/desktop/client', () => ({
  desktopClient: {
    isAvailable: vi.fn().mockReturnValue(false),
    invoke: vi
      .fn()
      .mockResolvedValue({
        provider: 'portal',
        canConfigure: true,
        registered: false,
        actions: {},
        defaults: {},
        systemTriggers: {},
        platform: 'linux',
      }),
    listen: vi.fn().mockResolvedValue(() => {}),
  },
}))

import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { useMenuModalsStore } from '../../stores/menu-modals'

describe('VoiceRecognitionMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useDesktopStore().desktopState.isWindowShown = true
    vi.clearAllMocks()
    mocks.startDictation.mockResolvedValue(undefined)
    mocks.cancelDictation.mockResolvedValue(undefined)
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
  describe('voice completion shortcuts', () => {
    const mountVoiceInput = (
      finishBehavior: 'submitToChat' | 'insertIntoTarget' | 'confirm'
    ) =>
      mount(VoiceRecognitionMenu, {
        props: { variant: 'sheet', finishBehavior },
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
      document.dispatchEvent(new KeyboardEvent('keydown', init))
      document.dispatchEvent(new KeyboardEvent('keyup', init))
      await flushPromises()
    }

    it.each(['Enter', 'Space'])(
      'ignores a %s release whose press opened the input',
      async (code) => {
        const wrapper = mountVoiceInput('insertIntoTarget')
        await flushPromises()

        document.dispatchEvent(new KeyboardEvent('keyup', { code }))
        await flushPromises()

        expect(mocks.finishDictation).not.toHaveBeenCalled()
        await keyUp({ code })
        expect(wrapper.emitted('corrected')?.[0]?.[3]).toBe('insert')
        wrapper.unmount()
      }
    )

    it.each([
      ['submitToChat', { code: 'Enter' }, 'submit'],
      ['submitToChat', { code: 'Space' }, 'submit'],
      ['submitToChat', { code: 'Enter', shiftKey: true }, 'insert'],
      ['submitToChat', { code: 'Space', shiftKey: true }, 'insert'],
      ['submitToChat', { code: 'Tab' }, 'next'],
      ['insertIntoTarget', { code: 'Enter' }, 'insert'],
      ['insertIntoTarget', { code: 'Space' }, 'insert'],
      ['insertIntoTarget', { code: 'Tab' }, 'next'],
      ['confirm', { code: 'Enter' }, 'insert'],
      ['confirm', { code: 'Space' }, 'insert'],
    ] as const)('%s finishes %o with %s', async (behavior, init, intent) => {
      const wrapper = mountVoiceInput(behavior)
      await flushPromises()

      await keyUp(init)

      expect(wrapper.emitted('corrected')?.[0]?.[3]).toBe(intent)
      wrapper.unmount()
    })

    it('keeps Tab available for focus navigation in confirm mode', async () => {
      const wrapper = mountVoiceInput('confirm')
      await flushPromises()
      const event = new KeyboardEvent('keydown', {
        code: 'Tab',
        cancelable: true,
      })
      window.dispatchEvent(event)
      await keyUp({ code: 'Tab' })

      expect(event.defaultPrevented).toBe(false)
      expect(mocks.finishDictation).not.toHaveBeenCalled()
      expect(wrapper.emitted('corrected')).toBeUndefined()
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

  it('restarts recording when the same voice mode is activated again', async () => {
    const wrapper = mountChat()
    await flushPromises()
    expect(mocks.startDictation).toHaveBeenCalledOnce()
    useDesktopStore().desktopState.activationId++
    await flushPromises()
    expect(mocks.startDictation).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('cancelled')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not emit a transcript from the preceding activation', async () => {
    let resolve!: (text: string) => void
    mocks.finishDictation.mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    const wrapper = mountChat()
    await flushPromises()
    await wrapper.find('button[title="chat.voiceSendHint"]').trigger('click')
    await flushPromises()
    useDesktopStore().desktopState.activationId++
    await flushPromises()
    resolve('Old transcript')
    await flushPromises()
    expect(wrapper.emitted('corrected')).toBeUndefined()
    expect(wrapper.emitted('cancelled')).toBeUndefined()
    wrapper.unmount()
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

  it('keeps the raw text when its correction is cancelled, ignoring a late reply', async () => {
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
    expect(wrapper.emitted('corrected')).toHaveLength(1)
    expect(wrapper.emitted('corrected')![0]![2]).toBeUndefined()
    expect(wrapper.emitted('cancelled')).toBeUndefined()
    expect(menu.pendingModal).toEqual({ label: 'New operation' })
    wrapper.unmount()
  })

  it('renders styling keyboard when isStylingBarEnabled is true and activationMode is voice', async () => {
    const desktopStore = useDesktopStore()
    desktopStore.desktopState.userConfig.stt.isStylingBarEnabled = true
    desktopStore.desktopState.userConfig.styling = {
      slots: { q: 'style-1' },
      items: [
        {
          id: 'style-1',
          name: 'Professional',
          rule: 'Make it sound professional',
        },
      ],
    }

    const wrapper = mount(VoiceRecognitionMenu, {
      props: {
        variant: 'bar',
        activationMode: 'voice',
        finishBehavior: 'insertIntoTarget',
      },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
        },
      },
    })
    await flushPromises()

    const styleButtons = wrapper.findAll('.voice-bar-styling-grid button')
    expect(styleButtons.length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('Professional')

    wrapper.unmount()
  })

  it('finishes with style and bypasses voice correction when a style key is pressed', async () => {
    const desktopStore = useDesktopStore()
    desktopStore.desktopState.userConfig.stt.isStylingBarEnabled = true
    desktopStore.desktopState.userConfig.styling = {
      slots: { q: 'style-1' },
      items: [
        {
          id: 'style-1',
          name: 'Professional',
          rule: 'Make it sound professional',
        },
      ],
    }
    mocks.shouldFormatRecognizedText.mockReturnValue(true)
    mocks.finishDictation.mockResolvedValue('raw dictated text')
    mocks.stylingPrompt.mockResolvedValue('Styled professional text')

    const wrapper = mount(VoiceRecognitionMenu, {
      props: {
        variant: 'bar',
        activationMode: 'voice',
        finishBehavior: 'insertIntoTarget',
      },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
        },
      },
    })
    await flushPromises()

    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q' })
    )
    document.dispatchEvent(
      new KeyboardEvent('keyup', { code: 'KeyQ', key: 'q' })
    )
    await flushPromises()

    expect(mocks.stylingPrompt).toHaveBeenCalledWith(
      'Make it sound professional',
      'raw dictated text',
      expect.anything()
    )
    expect(mocks.voiceCorrection).not.toHaveBeenCalled()
    expect(wrapper.emitted('corrected')).toEqual([
      [
        'Styled professional text',
        'raw dictated text',
        'Styled professional text',
        'next',
      ],
    ])

    wrapper.unmount()
  })

  it('finishes with insert intent when isStylingBarDirectInsertEnabled is true', async () => {
    const desktopStore = useDesktopStore()
    desktopStore.desktopState.userConfig.stt.isStylingBarEnabled = true
    desktopStore.desktopState.userConfig.stt.isStylingBarDirectInsertEnabled = true
    desktopStore.desktopState.userConfig.styling = {
      slots: { q: 'style-1' },
      items: [
        {
          id: 'style-1',
          name: 'Professional',
          rule: 'Make it sound professional',
        },
      ],
    }
    mocks.shouldFormatRecognizedText.mockReturnValue(true)
    mocks.finishDictation.mockResolvedValue('raw dictated text')
    mocks.stylingPrompt.mockResolvedValue('Styled professional text')

    const wrapper = mount(VoiceRecognitionMenu, {
      props: {
        variant: 'bar',
        activationMode: 'voice',
        finishBehavior: 'insertIntoTarget',
      },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
        },
      },
    })
    await flushPromises()

    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q' })
    )
    document.dispatchEvent(
      new KeyboardEvent('keyup', { code: 'KeyQ', key: 'q' })
    )
    await flushPromises()

    expect(wrapper.emitted('corrected')).toEqual([
      [
        'Styled professional text',
        'raw dictated text',
        'Styled professional text',
        'insert',
      ],
    ])

    wrapper.unmount()
  })

  it('finishes with style when a style button is clicked', async () => {
    const desktopStore = useDesktopStore()
    desktopStore.desktopState.userConfig.stt.isStylingBarEnabled = true
    desktopStore.desktopState.userConfig.styling = {
      slots: { q: 'style-1' },
      items: [
        {
          id: 'style-1',
          name: 'Professional',
          rule: 'Make it sound professional',
        },
      ],
    }
    mocks.shouldFormatRecognizedText.mockReturnValue(true)
    mocks.finishDictation.mockResolvedValue('raw dictated text')
    mocks.stylingPrompt.mockResolvedValue('Styled professional text')

    const wrapper = mount(VoiceRecognitionMenu, {
      props: {
        variant: 'bar',
        activationMode: 'voice',
        finishBehavior: 'insertIntoTarget',
      },
      global: {
        stubs: {
          LiveTranscript: {
            props: ['committed', 'draft', 'prefix', 'suffix'],
            template: '<div class="live-transcript" />',
          },
        },
      },
    })
    await flushPromises()

    const styleButton = wrapper.find('.voice-bar-styling-grid button')
    await styleButton.trigger('click')
    await flushPromises()

    expect(mocks.stylingPrompt).toHaveBeenCalledWith(
      'Make it sound professional',
      'raw dictated text',
      expect.anything()
    )
    expect(mocks.voiceCorrection).not.toHaveBeenCalled()
    expect(wrapper.emitted('corrected')).toEqual([
      [
        'Styled professional text',
        'raw dictated text',
        'Styled professional text',
        'next',
      ],
    ])

    wrapper.unmount()
  })
})
