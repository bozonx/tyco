import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import VoiceTransformationMenu from './VoiceTransformationMenu.vue'

const dictationMocks = vi.hoisted(() => ({
  startDictation: vi.fn().mockResolvedValue(undefined),
  finishDictation: vi.fn().mockResolvedValue('make it concise'),
  cancelDictation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../composables/use-dictation-actions', () => ({
  useDictationActions: () => ({
    startDictation: dictationMocks.startDictation,
    finishDictation: dictationMocks.finishDictation,
    cancelDictation: dictationMocks.cancelDictation,
  }),
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const invokeCall = vi.hoisted(() => vi.fn())
vi.mock('../../stores/invocations', () => ({
  useInvocationsStore: () => ({ call: invokeCall }),
}))

describe('VoiceTransformationMenu', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
    dictationMocks.startDictation.mockReset().mockResolvedValue(undefined)
    dictationMocks.finishDictation
      .mockReset()
      .mockResolvedValue('make it concise')
    dictationMocks.cancelDictation.mockReset().mockResolvedValue(undefined)
    invokeCall
      .mockReset()
      .mockResolvedValue({
        ok: true,
        content: 'Concise text',
        meta: { provider: 'llm', kind: 'llm' },
      })
  })

  afterEach(() => {
    desktop.dispose()
  })

  it('starts dictation on mount and renders TextPreview and Waveform', async () => {
    const wrapper = mount(VoiceTransformationMenu, {
      props: { text: 'Some long verbose text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: {
            props: ['text'],
            template: '<div class="text-preview">{{ text }}</div>',
          },
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
          AudioWaveform: true,
          LiveTranscript: {
            props: ['committed', 'draft'],
            template: '<div class="live-transcript">{{ committed }}</div>',
          },
          ShortcutButton: true,
        },
      },
    })
    await flushPromises()

    expect(dictationMocks.startDictation).toHaveBeenCalled()
    expect(wrapper.find('.text-preview').text()).toBe('Some long verbose text')
  })

  it('finishes dictation and triggers core.transformation with transcribed text', async () => {
    let capturedOnText: any
    dictationMocks.startDictation.mockImplementationOnce(
      async ({ onText }: any) => {
        capturedOnText = onText
      }
    )

    const wrapper = mount(VoiceTransformationMenu, {
      props: { text: 'Some long verbose text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
          AudioWaveform: true,
          LiveTranscript: {
            props: ['committed', 'draft'],
            template: '<div class="live-transcript">{{ committed }}</div>',
          },
          ShortcutButton: {
            props: ['variant', 'disabled'],
            template:
              '<button class="shortcut-btn" :data-variant="variant" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    })
    await flushPromises()

    capturedOnText?.({ committed: 'make it concise', draft: '' })

    const primaryBtn = wrapper.find('.shortcut-btn[data-variant="primary"]')
    await primaryBtn.trigger('click')
    await flushPromises()

    expect(dictationMocks.finishDictation).toHaveBeenCalled()
    expect(invokeCall).toHaveBeenCalledWith(
      'core.transformation',
      'Some long verbose text',
      expect.objectContaining({ toolConfig: { prompt: 'make it concise' } })
    )

    const modalsStore = useMenuModalsStore()
    expect(modalsStore.currentModal).toBe(MenuModals.DIFF)
  })

  it('finishes dictation on Space key press', async () => {
    let capturedOnText: any
    dictationMocks.startDictation.mockImplementationOnce(
      async ({ onText }: any) => {
        capturedOnText = onText
      }
    )

    mount(VoiceTransformationMenu, {
      props: { text: 'Some long verbose text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
          AudioWaveform: true,
          LiveTranscript: {
            props: ['committed', 'draft'],
            template: '<div class="live-transcript">{{ committed }}</div>',
          },
          ShortcutButton: true,
        },
      },
    })
    await flushPromises()

    capturedOnText?.({ committed: 'make it shorter', draft: '' })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    await flushPromises()

    expect(dictationMocks.finishDictation).toHaveBeenCalled()
    expect(invokeCall).toHaveBeenCalledWith(
      'core.transformation',
      'Some long verbose text',
      expect.objectContaining({ toolConfig: { prompt: 'make it shorter' } })
    )
  })

  it('cancels dictation and hides window on Escape when opened directly', async () => {
    mount(VoiceTransformationMenu, {
      props: { text: 'Some long verbose text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
          AudioWaveform: true,
          LiveTranscript: {
            props: ['committed', 'draft'],
            template: '<div class="live-transcript">{{ committed }}</div>',
          },
          ShortcutButton: true,
        },
      },
    })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(dictationMocks.cancelDictation).toHaveBeenCalled()
    expect(
      desktop.backend.calls.some((call) => call.command === 'hide_window')
    ).toBe(true)
  })

  it('cancels dictation and goes back on Escape when entered from another menu', async () => {
    const modalsStore = useMenuModalsStore()
    modalsStore.nextModal(MenuModals.INSERT, { text: 'Initial' })
    modalsStore.nextModal(MenuModals.VOICE_TRANSFORMATION, {
      text: 'Some long verbose text',
    })

    mount(VoiceTransformationMenu, {
      props: { text: 'Some long verbose text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
          AudioWaveform: true,
          LiveTranscript: {
            props: ['committed', 'draft'],
            template: '<div class="live-transcript">{{ committed }}</div>',
          },
          ShortcutButton: true,
        },
      },
    })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(dictationMocks.cancelDictation).toHaveBeenCalled()
    expect(modalsStore.currentModal).toBe(MenuModals.INSERT)
  })

  it('resets finishing state and stops spinner when LLM request is cancelled', async () => {
    let capturedOnText: any
    dictationMocks.startDictation.mockImplementationOnce(
      async ({ onText }: any) => {
        capturedOnText = onText
      }
    )

    invokeCall.mockImplementationOnce(
      (_tool: string, _text: string, options: any) => {
        return new Promise((resolve) => {
          options.signal?.addEventListener('abort', () => {
            resolve({ ok: false, cancelled: true, message: 'Cancelled' })
          })
        })
      }
    )

    const wrapper = mount(VoiceTransformationMenu, {
      props: { text: 'Some long verbose text' },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template:
              '<div class="layout"><slot name="preview" /><slot name="actions" /></div>',
          },
          AudioWaveform: {
            props: ['isTranscribing'],
            template:
              '<div class="waveform" :data-transcribing="isTranscribing">Waveform</div>',
          },
          LiveTranscript: {
            props: ['committed', 'draft'],
            template: '<div class="live-transcript">{{ committed }}</div>',
          },
          ShortcutButton: {
            props: ['variant', 'disabled'],
            template:
              '<button class="shortcut-btn" :data-variant="variant" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    })
    await flushPromises()

    capturedOnText?.({ committed: 'make it concise', draft: '' })

    const primaryBtn = wrapper.find('.shortcut-btn[data-variant="primary"]')
    await primaryBtn.trigger('click')
    await flushPromises()

    // While LLM call is running, waveform is in transcribing mode
    expect(wrapper.find('.waveform').attributes('data-transcribing')).toBe(
      'true'
    )
    expect(primaryBtn.attributes('disabled')).toBeDefined()

    // Cancel pending modal
    const modalsStore = useMenuModalsStore()
    expect(modalsStore.pendingModal).not.toBeNull()
    modalsStore.cancelPending()
    await flushPromises()

    // After cancellation, isFinishing should be false and spinner gone
    expect(wrapper.find('.waveform').attributes('data-transcribing')).toBe(
      'false'
    )
    expect(primaryBtn.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.live-transcript').text()).toBe('make it concise')
  })
})
