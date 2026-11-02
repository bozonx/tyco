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
    desktop = installFakeDesktop()
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
})
