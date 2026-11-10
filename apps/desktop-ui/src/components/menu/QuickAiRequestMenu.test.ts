import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useToastStore } from '../../stores/toast'
import QuickAiRequestMenu from './QuickAiRequestMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('QuickAiRequestMenu', () => {
  let desktop: TestDesktop

  beforeEach(() => {
    desktop = installFakeDesktop({}, 'quick')
    desktop.backend.handle('hide_window', () => undefined)
    desktop.backend.handle('paste_into_target_and_hide', () => undefined)
    desktop.backend.handle('open_main_chat', () => undefined)
    desktop.backend.handle('save_chat', () => undefined)
    desktop.backend.handle('list_recent_quick_request_prompts', () => [])
    desktop.backend.handle('copy_text', () => undefined)
    desktop.backend.handle('add_editor_history_item', () => 'history-1')
    desktop.backend.handle('start_fetch', () => {
      throw new Error('offline in test')
    })

    desktop.setUserConfig({
      llm: {
        ...desktop.backend.userConfig.llm,
        tasks: {
          ...desktop.backend.userConfig.llm.tasks,
          quickRequest: { modelId: 'gpt-4', rule: '' },
        },
        models: [
          {
            id: 'gpt-4',
            name: 'GPT 4',
            providerId: 'ollama',
            providerModelId: 'gpt-4',
            canUseImages: false,
            canUseTools: true,
          },
        ],
      },
    })
  })

  afterEach(() => {
    desktop.dispose()
  })

  const mountMenu = (props: Record<string, unknown> = {}) =>
    mount(QuickAiRequestMenu, {
      props: { text: 'Source text for AI', ...props },
      global: {
        plugins: [desktop.pinia],
        stubs: {
          AppIcon: true,
          IconButton: {
            props: ['icon', 'title', 'disabled', 'label'],
            template:
              '<button class="icon-btn" :title="title ?? label" :aria-label="label" :disabled="disabled" @click="$attrs.onClick"><slot /></button>',
          },
          KeyboardKey: { template: '<kbd class="kbd"><slot /></kbd>' },
          VoiceRecognitionMenu: {
            name: 'VoiceRecognitionMenu',
            props: [
              'variant',
              'chat',
              'target',
              'finishBehavior',
              'activationMode',
              'prefix',
              'suffix',
            ],
            emits: ['cancelled', 'corrected'],
            template:
              '<div class="voice-bar" :data-prefix="prefix" :data-suffix="suffix" />',
          },
          ReplyBlock: {
            props: ['block'],
            template:
              '<div class="reply-block"><span class="reply-text">{{ block.text }}</span></div>',
          },
        },
      },
    })

  it('renders preview with source text', () => {
    const wrapper = mountMenu({ text: 'Hello text to transform' })
    expect(wrapper.text()).toContain('Hello text to transform')
  })

  it('disables and restores source text context preview', async () => {
    const wrapper = mountMenu({ text: 'Hello text to transform' })
    expect(wrapper.text()).toContain('Hello text to transform')

    const removeBtn = wrapper.find('button[aria-label="action.removeContext"]')
    expect(removeBtn.exists()).toBe(true)
    await removeBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.context-disabled-banner').exists()).toBe(true)

    const restoreBtn = wrapper.find('.context-restore-btn')
    expect(restoreBtn.exists()).toBe(true)
    await restoreBtn.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.context-disabled-banner').exists()).toBe(false)
    expect(wrapper.text()).toContain('Hello text to transform')
  })

  it('shows the profile and model selectors under the input, not in the header', () => {
    const wrapper = mountMenu()
    expect(wrapper.find('.action-overlay-header select').exists()).toBe(false)
    const bar = wrapper.find('.query-panel-footer .quick-ai-model-bar')
    expect(bar.findAll('select')).toHaveLength(2)
    expect(bar.find('option').text()).toBe('quickAiRequest.standardProfile')
    expect(wrapper.find('[aria-label="action.askInChat"]').exists()).toBe(false)
  })

  it('tells by the placeholder what the request is about', () => {
    expect(
      mountMenu().find('.query-panel-input').attributes('placeholder')
    ).toBe('quickAiRequest.placeholder.selection')
    expect(
      mountMenu({ text: '' })
        .find('.query-panel-input')
        .attributes('placeholder')
    ).toBe('quickAiRequest.placeholder.empty')
  })

  it('clears the input as soon as the question is sent', async () => {
    desktop.backend.handle('start_fetch', () => new Promise(() => undefined))

    const wrapper = mountMenu({ text: 'Context' })
    const input = wrapper.find('.query-panel-input')
    await input.setValue('First question')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.find('.stop-action-btn').exists()).toBe(true)
    expect(wrapper.find('.turn-prompt-text').text()).toBe('First question')
    expect((input.element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('shows error banner when model is not configured', async () => {
    desktop.setUserConfig({
      llm: {
        ...desktop.backend.userConfig.llm,
        tasks: {
          ...desktop.backend.userConfig.llm.tasks,
          quickRequest: { modelId: '', rule: '' },
        },
        models: [],
      },
    })

    const wrapper = mountMenu()
    await flushPromises()

    // told before the user types anything
    expect(wrapper.find('.quick-error-banner').exists()).toBe(true)
    expect(wrapper.find('.quick-error-text').text()).toBe(
      'quickAiRequest.noModel'
    )
  })

  it('shows error banner when model does not support tools', async () => {
    desktop.setUserConfig({
      llm: {
        ...desktop.backend.userConfig.llm,
        tasks: {
          ...desktop.backend.userConfig.llm.tasks,
          quickRequest: { modelId: 'simple-model', rule: '' },
        },
        models: [
          {
            id: 'simple-model',
            name: 'Simple',
            providerId: 'ollama',
            providerModelId: 'simple-model',
            canUseImages: false,
            canUseTools: false,
          },
        ],
      },
    })

    const wrapper = mountMenu()
    await flushPromises()
    expect(wrapper.find('.quick-error-text').text()).toBe(
      'llmErrors.toolsRequired'
    )

    const input = wrapper.find('.query-panel-input')
    await input.setValue('Explain this')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.find('.quick-error-text').text()).toBe(
      'llmErrors.toolsRequired'
    )
  })

  it('reads the keys, so that the models of keyed providers are listed', async () => {
    desktop.backend.handle('get_secret_statuses', () => ({
      'llm.google': {
        available: true,
        origins: ['https://generativelanguage.googleapis.com'],
      },
    }))
    desktop.setUserConfig({
      llm: {
        ...desktop.backend.userConfig.llm,
        models: [
          ...desktop.backend.userConfig.llm.models,
          {
            id: 'gemini',
            name: 'Gemini',
            providerId: 'google',
            providerModelId: 'gemini',
            canUseImages: false,
            canUseTools: true,
          },
        ],
      },
    })

    const wrapper = mountMenu()
    await flushPromises()
    const labels = wrapper
      .findAll('select')[1]
      .findAll('option')
      .map((option) => option.text())
    expect(labels).toEqual([
      expect.stringContaining('GPT 4'),
      expect.stringContaining('Gemini'),
    ])
  })

  it('lists the models and remembers the pick of "Ask AI" in its task', async () => {
    desktop.setUserConfig({
      llm: {
        ...desktop.backend.userConfig.llm,
        models: [
          ...desktop.backend.userConfig.llm.models,
          {
            id: 'local',
            name: 'Local',
            providerId: 'ollama',
            providerModelId: 'local',
            canUseImages: false,
            canUseTools: false,
          },
        ],
      },
    })

    const wrapper = mountMenu()
    const modelSelect = wrapper.findAll('select')[1]
    const labels = modelSelect.findAll('option').map((option) => option.text())
    expect(labels).toEqual([
      expect.stringContaining('GPT 4'),
      expect.stringContaining('chat.noToolCalling'),
    ])

    await modelSelect.setValue('1')
    await flushPromises()

    expect(desktop.backend.userConfig.llm.tasks.quickRequest.modelId).toBe(
      'local'
    )
    expect(wrapper.find('.quick-error-text').text()).toBe(
      'llmErrors.toolsRequired'
    )
  })

  it('calls open_main_chat when switching to chat', async () => {
    const openChatSpy = vi.fn()
    desktop.backend.handle('open_main_chat', openChatSpy)

    const wrapper = mountMenu({ text: 'Context to send' })
    const input = wrapper.find('.query-panel-input')
    await input.setValue('Draft question')
    await input.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()

    expect(openChatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Draft question',
        attachment: { text: 'Context to send', source: 'selection' },
      })
    )
  })

  it('stops the answer being generated and moves to the chat', async () => {
    const openChatSpy = vi.fn()
    desktop.backend.handle('open_main_chat', openChatSpy)
    desktop.backend.handle('start_fetch', () => new Promise(() => undefined))

    const wrapper = mountMenu({ text: 'Context' })
    const input = wrapper.find('.query-panel-input')
    await input.setValue('First question')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('.stop-action-btn').exists()).toBe(true)

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })
    )
    await flushPromises()
    // nothing was answered: the chat starts fresh with the context
    expect(openChatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: { text: 'Context', source: 'selection' },
      })
    )
    expect(wrapper.find('.stop-action-btn').exists()).toBe(false)
    wrapper.unmount()
  })

  describe('voice input and send button', () => {
    it('opens with VoiceRecognitionMenu bar when inputMode is voice', () => {
      const wrapper = mountMenu({ inputMode: 'voice' })
      expect(wrapper.find('.voice-bar').exists()).toBe(true)
      expect(wrapper.find('.query-panel-input').exists()).toBe(false)
    })

    it('switches to VoiceRecognitionMenu with prefix and suffix from cursor position', async () => {
      const wrapper = mountMenu()
      const input = wrapper.find('.query-panel-input')
      await input.setValue('Translate  please')
      const el = input.element as HTMLInputElement
      el.setSelectionRange(10, 10)

      await wrapper.find('[title="chat.voiceInput"]').trigger('click')

      const voiceBar = wrapper.find('.voice-bar')
      expect(voiceBar.exists()).toBe(true)
      expect(voiceBar.attributes('data-prefix')).toBe('Translate ')
      expect(voiceBar.attributes('data-suffix')).toBe(' please')
    })

    it('inserts recognized text into the input and shows enabled send button on insert intent', async () => {
      const wrapper = mountMenu()
      const input = wrapper.find('.query-panel-input')
      await input.setValue('Hello ')
      const el = input.element as HTMLInputElement
      el.setSelectionRange(6, 6)

      await wrapper.find('[title="chat.voiceInput"]').trigger('click')
      const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })
      voiceMenu.vm.$emit('corrected', 'world', 'world', undefined, 'insert')
      await flushPromises()

      expect(wrapper.find('.voice-bar').exists()).toBe(false)
      const restoredInput = wrapper.find('.query-panel-input')
      expect((restoredInput.element as HTMLInputElement).value).toBe(
        'Hello world'
      )

      const sendBtn = wrapper.find('[title="chat.sendMessage"]')
      expect(sendBtn.exists()).toBe(true)
      expect((sendBtn.element as HTMLButtonElement).disabled).toBe(false)
    })

    it('submits immediately when voice recognition finishes with submit intent', async () => {
      const wrapper = mountMenu({ inputMode: 'voice' })
      const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })
      voiceMenu.vm.$emit(
        'corrected',
        'Summarize this',
        'Summarize this',
        undefined,
        'submit'
      )
      await flushPromises()

      expect(wrapper.find('.turn-prompt-text').text()).toBe('Summarize this')
    })

    it('disables the send button when prompt is empty and submits on click when non-empty', async () => {
      const wrapper = mountMenu()
      const sendBtn = wrapper.find('[title="chat.sendMessage"]')
      expect((sendBtn.element as HTMLButtonElement).disabled).toBe(true)

      await wrapper.find('.query-panel-input').setValue('Make it shorter')
      expect((sendBtn.element as HTMLButtonElement).disabled).toBe(false)

      await sendBtn.trigger('click')
      await flushPromises()

      expect(wrapper.find('.turn-prompt-text').text()).toBe('Make it shorter')
    })

    it('starts voice capture with Gemini Live key when opened in voice mode with empty secret cache', async () => {
      desktop.backend.handle('get_secret_statuses', () => ({
        'llm.google': {
          available: true,
          origins: ['https://generativelanguage.googleapis.com'],
        },
      }))
      desktop.backend.handle('start_voice_capture', () => ({
        sessionId: 1,
        sampleRate: 16000,
      }))
      desktop.backend.handle('stop_voice_capture', () => undefined)
      desktop.backend.handle('open_socket', () => new Promise(() => undefined))
      desktop.setState({
        isWindowShown: true,
        mode: 'voiceQuickAiRequest',
        userConfig: {
          ...desktop.backend.userConfig,
          stt: {
            ...desktop.backend.userConfig.stt,
            provider: 'geminiLive',
          },
        },
      })

      const wrapper = mount(QuickAiRequestMenu, {
        props: { text: '', inputMode: 'voice' },
        global: {
          plugins: [desktop.pinia],
          stubs: { AppIcon: true },
        },
      })
      await flushPromises()

      expect(desktop.backend.callsOf('start_voice_capture')).toHaveLength(1)
      expect(useToastStore().toasts).toHaveLength(0)
      wrapper.unmount()
    })
  })

  describe('screenshot mode', () => {
    const screenshot = {
      id: 'shot-1',
      mediaType: 'image/webp' as const,
      width: 1920,
      height: 1080,
      size: 1000,
    }
    const mountScreenshotMenu = () =>
      mount(QuickAiRequestMenu, {
        props: { screenshotMode: true, screenshots: [screenshot] },
        global: {
          plugins: [desktop.pinia],
          stubs: {
            AppIcon: true,
            ChatImageAttachment: {
              props: ['image', 'removable'],
              template:
                '<div class="shot" :data-id="image.id"><button v-if="removable" class="remove-shot" @click="$emit(\'remove\')" /></div>',
            },
          },
        },
      })

    it('previews the screenshot and removes it', async () => {
      desktop.backend.handle('remove_screenshot', () => undefined)
      const wrapper = mountScreenshotMenu()
      expect(wrapper.find('.shot').attributes('data-id')).toBe('shot-1')

      await wrapper.find('.remove-shot').trigger('click')
      await flushPromises()
      expect(
        desktop.backend
          .callsOf('remove_screenshot')
          .some((c) => c.imageId === 'shot-1')
      ).toBe(true)
      expect(wrapper.find('.shot').exists()).toBe(false)
    })

    it('adds another screenshot after a successful capture and keeps the draft', async () => {
      desktop.backend.handle('add_screenshot', () => ({
        ...screenshot,
        id: 'shot-2',
      }))
      const wrapper = mountScreenshotMenu()
      await wrapper.find('.query-panel-input').setValue('What is this?')
      await wrapper.find('[title="screenshot.addArea"]').trigger('click')
      await flushPromises()

      const shots = wrapper.findAll('.shot')
      expect(shots).toHaveLength(2)
      expect(shots[0].attributes('data-id')).toBe('shot-1')
      expect(shots[1].attributes('data-id')).toBe('shot-2')
      expect(
        (wrapper.find('.query-panel-input').element as HTMLTextAreaElement)
          .value
      ).toBe('What is this?')
    })

    it('keeps previous screenshots when adding is cancelled', async () => {
      desktop.backend.handle('add_screenshot', () => null)
      const wrapper = mountScreenshotMenu()
      await wrapper.find('[title="screenshot.addArea"]').trigger('click')
      await flushPromises()
      expect(wrapper.findAll('.shot')).toHaveLength(1)
      expect(wrapper.find('.shot').attributes('data-id')).toBe('shot-1')
    })

    it('keeps the draft when the model cannot read images', async () => {
      const wrapper = mountScreenshotMenu()
      const input = wrapper.find('.query-panel-input')
      await input.setValue('What is this?')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()

      expect(wrapper.find('.quick-error-text').text()).toBe(
        'chat.imageModelRequired'
      )
      expect((input.element as HTMLTextAreaElement).value).toBe('What is this?')
    })
  })
})
