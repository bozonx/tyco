import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import { useLlmStore } from '../../stores/llm'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useToastStore } from '../../stores/toast'
import QuickAiRequestMenu from './QuickAiRequestMenu.vue'

vi.mock('../../composables/use-i18n', async () => {
  const { ref } = await import('vue')
  return { useI18n: () => ({ t: (key: string) => key, locale: ref('en-US') }) }
})

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
            props: {
              variant: String,
              chat: Boolean,
              cancelShortcut: Boolean,
              target: String,
              finishBehavior: String,
              activationMode: String,
              prefix: String,
              suffix: String,
            },
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

  async function answerRequest(
    blocks: { title?: string; text: string }[] = []
  ) {
    vi.spyOn(useLlmStore().actions, 'sendChatMessage').mockImplementationOnce(
      async (_message, _history, _instructions, options) => {
        const answer = {
          content: blocks.length ? '' : 'An explanation',
          parts: blocks.length
            ? [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'reply-1',
                  toolName: 'propose_replies',
                  input: { blocks },
                  state: 'done' as const,
                },
              ]
            : [],
        }
        options.onUpdate?.(answer)
        return answer
      }
    )
    const wrapper = mountMenu()
    await wrapper.find('.query-panel-input').setValue('Help me')
    await wrapper
      .find('.query-panel-input')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    return wrapper
  }

  it.each(['Enter', ' '])('inserts a completed result with %j', async (key) => {
    const wrapper = await answerRequest([{ text: 'Ready to paste' }])
    expect(wrapper.find('.query-panel-input').exists()).toBe(false)
    expect(wrapper.find('.quick-insert-action').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key }))
    await flushPromises()
    expect(desktop.backend.callsOf('paste_into_target_and_hide')).toEqual([
      expect.objectContaining({ text: 'Ready to paste' }),
    ])
  })

  it('keeps plain answers without insertion and reopens the composer for a follow-up', async () => {
    const wrapper = await answerRequest()
    expect(wrapper.find('.quick-insert-action').exists()).toBe(false)
    expect(wrapper.find('.query-panel-input').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(desktop.backend.callsOf('paste_into_target_and_hide')).toHaveLength(
      0
    )
    const followUp = wrapper
      .findAll('button')
      .find((button) => button.text() === 'quickAiRequest.followUp')!
    await followUp.trigger('click')
    await flushPromises()
    expect(wrapper.find('.query-panel-input').exists()).toBe(true)
    expect(wrapper.find('.turn-prompt-text').text()).toBe('Help me')
    await wrapper.find('.query-panel-input').setValue('Why?')
    await wrapper
      .find('.query-panel-input')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(
      wrapper.findAll('.turn-prompt-text').map((item) => item.text())
    ).toEqual(['Help me', 'Why?'])
    expect(wrapper.find('.query-panel-input').exists()).toBe(true)
  })

  it('requires selection before inserting multiple variants', async () => {
    const wrapper = await answerRequest([
      { title: 'A', text: 'First' },
      { title: 'B', text: 'Second' },
    ])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(desktop.backend.callsOf('paste_into_target_and_hide')).toHaveLength(
      0
    )
    await wrapper
      .find('select[aria-label="quickAiRequest.chooseVariant"]')
      .setValue('2')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }))
    await flushPromises()
    expect(desktop.backend.callsOf('paste_into_target_and_hide')).toEqual([
      expect.objectContaining({ text: 'Second' }),
    ])
  })

  it('continues a completed result in the main chat only via button click, not Ctrl+Enter', async () => {
    desktop.backend.handle('open_transferred_chat', () => undefined)
    const wrapper = await answerRequest([{ text: 'Ready' }])
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })
    )
    await flushPromises()
    expect(desktop.backend.callsOf('open_transferred_chat')).toHaveLength(0)

    const chatBtn = wrapper
      .findAll('button')
      .find((button) => button.text().includes('action.askInChat'))!
    await chatBtn.trigger('click')
    await flushPromises()
    expect(desktop.backend.callsOf('open_transferred_chat')).toHaveLength(1)
    expect(desktop.backend.callsOf('paste_into_target_and_hide')).toHaveLength(
      0
    )
  })

  it('opens InsertMenu with diff and back escMode when clicking Next on result', async () => {
    const wrapper = await answerRequest([{ text: 'Improved text' }])
    const menuModals = useMenuModalsStore()
    const nextSpy = vi.spyOn(menuModals, 'nextModal')

    await wrapper.find('.quick-next-action').trigger('click')
    expect(nextSpy).toHaveBeenCalledWith(MenuModals.INSERT, {
      text: 'Improved text',
      oldText: 'Source text for AI',
      escMode: 'back',
    })
  })

  it('opens InsertMenu without oldText when source context was disabled', async () => {
    vi.spyOn(useLlmStore().actions, 'sendChatMessage').mockImplementationOnce(
      async (_message, _history, _instructions, options) => {
        const answer = {
          content: '',
          parts: [
            {
              type: 'tool-call' as const,
              toolCallId: 'reply-1',
              toolName: 'propose_replies',
              input: { blocks: [{ text: 'Fresh answer' }] },
              state: 'done' as const,
            },
          ],
        }
        options.onUpdate?.(answer)
        return answer
      }
    )
    const wrapper = mountMenu()
    await wrapper
      .find('button[aria-label="action.removeContext"]')
      .trigger('click')
    await wrapper.find('.query-panel-input').setValue('Write something')
    await wrapper
      .find('.query-panel-input')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()

    const nextSpy = vi.spyOn(useMenuModalsStore(), 'nextModal')
    await wrapper.find('.quick-next-action').trigger('click')
    expect(nextSpy).toHaveBeenCalledWith(MenuModals.INSERT, {
      text: 'Fresh answer',
      oldText: undefined,
      escMode: 'back',
    })
  })

  it('does not insert twice while a paste is pending', async () => {
    let finishPaste!: () => void
    desktop.backend.handle(
      'paste_into_target_and_hide',
      () =>
        new Promise<void>((resolve) => {
          finishPaste = resolve
        })
    )
    const wrapper = await answerRequest([{ text: 'Ready' }])
    await wrapper.find('.quick-insert-action').trigger('click')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    await flushPromises()
    expect(desktop.backend.callsOf('paste_into_target_and_hide')).toHaveLength(
      1
    )
    finishPaste()
    await flushPromises()
  })

  it('ignores held keys, modifiers, composition and events from controls', async () => {
    const wrapper = await answerRequest([{ text: 'Ready' }])
    for (const options of [
      { repeat: true },
      { shiftKey: true },
      { altKey: true },
      { metaKey: true },
      { isComposing: true },
    ]) {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ...options })
      )
    }
    await wrapper
      .find('.quick-result-actions button')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(desktop.backend.callsOf('paste_into_target_and_hide')).toHaveLength(
      0
    )
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

  it('calls open_main_chat when clicking ask in chat, not on Ctrl+Enter', async () => {
    const openChatSpy = vi.fn()
    desktop.backend.handle('open_main_chat', openChatSpy)

    const wrapper = mountMenu({ text: 'Context to send' })
    const input = wrapper.find('.query-panel-input')
    await input.setValue('Draft question')
    await input.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(openChatSpy).not.toHaveBeenCalled()

    const chatBtn = wrapper
      .findAll('button')
      .find((button) => button.text().includes('action.askInChat'))!
    await chatBtn.trigger('click')
    await flushPromises()

    expect(openChatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Draft question',
        attachment: { text: 'Context to send', source: 'selection' },
      })
    )
  })

  it('does not insert into editor on Tab, only on button click', async () => {
    desktop.backend.handle('open_main_editor', () => undefined)
    const wrapper = mountMenu({ text: 'Source text' })
    const input = wrapper.find('.query-panel-input')
    await input.trigger('keydown', { key: 'Tab' })
    await flushPromises()
    expect(desktop.backend.callsOf('open_main_editor')).toHaveLength(0)

    const editorBtn = wrapper
      .findAll('button')
      .find((button) => button.text().includes('shortcuts.insertIntoEditor'))!
    await editorBtn.trigger('click')
    await flushPromises()
    expect(desktop.backend.callsOf('open_main_editor')).toHaveLength(1)
  })

  it('stops the answer being generated and moves to the chat when clicking ask in chat', async () => {
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
    expect(openChatSpy).not.toHaveBeenCalled()

    const chatBtn = wrapper
      .findAll('button')
      .find((button) => button.text().includes('action.askInChat'))!
    await chatBtn.trigger('click')
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

  describe('recent prompts popup', () => {
    it('shows recent prompts above the input while empty, hides on typing, and inserts on ArrowUp + Enter before sending', async () => {
      desktop.backend.handle('list_recent_quick_request_prompts', () => [
        'Newest prompt',
        'Older prompt',
      ])
      desktop.backend.handle('start_fetch', () => new Promise(() => undefined))

      const wrapper = mountMenu()
      await flushPromises()

      const list = wrapper.find('.query-panel-options')
      expect(list.classes()).toContain('is-above-popover')
      expect(
        wrapper.findAll('.query-panel-option').map((item) => item.text())
      ).toEqual(['Older prompt', 'Newest prompt'])

      const input = wrapper.find('.query-panel-input')
      await input.setValue('New')
      expect(wrapper.find('.query-panel-options').exists()).toBe(false)

      await input.setValue('')
      expect(wrapper.find('.query-panel-options').exists()).toBe(true)

      await input.trigger('keydown', { key: 'ArrowUp' })
      expect(wrapper.findAll('.query-panel-option')[1].classes()).toContain(
        'is-highlighted'
      )

      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect((input.element as HTMLInputElement).value).toBe('Newest prompt')
      expect(wrapper.find('.query-panel-options').exists()).toBe(false)
      expect(wrapper.find('.turn-prompt-text').exists()).toBe(false)

      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(wrapper.find('.turn-prompt-text').text()).toBe('Newest prompt')
      wrapper.unmount()
    })

    it('inserts into the input on mouse click without sending immediately and does not keep mouseenter highlight for Enter', async () => {
      desktop.backend.handle('list_recent_quick_request_prompts', () => [
        'Newest prompt',
        'Older prompt',
      ])
      desktop.backend.handle('start_fetch', () => new Promise(() => undefined))

      const wrapper = mountMenu()
      await flushPromises()

      const options = wrapper.findAll('.query-panel-option')
      await options[0].trigger('mouseenter')
      expect(options[0].classes()).not.toContain('is-highlighted')

      const input = wrapper.find('.query-panel-input')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(wrapper.find('.turn-prompt-text').exists()).toBe(false)

      await options[0].trigger('click')
      await flushPromises()
      expect((input.element as HTMLInputElement).value).toBe('Older prompt')
      expect(wrapper.find('.query-panel-options').exists()).toBe(false)
      expect(wrapper.find('.turn-prompt-text').exists()).toBe(false)

      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(wrapper.find('.turn-prompt-text').text()).toBe('Older prompt')
      wrapper.unmount()
    })
  })

  describe('voice input and run button', () => {
    it('opens with VoiceRecognitionMenu bar when inputMode is voice', () => {
      const wrapper = mountMenu({ inputMode: 'voice' })
      expect(wrapper.find('.voice-bar').exists()).toBe(true)
      expect(wrapper.find('.query-panel-input').exists()).toBe(false)
      const voiceMenu = wrapper.findComponent({ name: 'VoiceRecognitionMenu' })
      expect(voiceMenu.props('cancelShortcut')).toBe(true)
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

    it('inserts recognized text into the input and enables the footer run button without a duplicate send icon', async () => {
      const wrapper = mountMenu()
      expect(wrapper.find('[title="chat.sendMessage"]').exists()).toBe(false)

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

      const runBtn = wrapper.find('.run-action-btn')
      expect(runBtn.exists()).toBe(true)
      expect((runBtn.element as HTMLButtonElement).disabled).toBe(false)
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

    it('disables the run button when prompt is empty and submits on click when non-empty', async () => {
      const wrapper = mountMenu()
      const runBtn = wrapper.find('.run-action-btn')
      expect((runBtn.element as HTMLButtonElement).disabled).toBe(true)

      await wrapper.find('.query-panel-input').setValue('Make it shorter')
      expect((runBtn.element as HTMLButtonElement).disabled).toBe(false)

      await runBtn.trigger('click')
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
          stt: { ...desktop.backend.userConfig.stt, provider: 'geminiLive' },
        },
      })

      const wrapper = mount(QuickAiRequestMenu, {
        props: { text: '', inputMode: 'voice' },
        global: { plugins: [desktop.pinia], stubs: { AppIcon: true } },
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
    const mountScreenshotMenu = () => {
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: vi.fn(function (this: HTMLDialogElement) {
          this.setAttribute('open', '')
        }),
      })
      Object.defineProperty(HTMLDialogElement.prototype, 'close', {
        configurable: true,
        value: vi.fn(function (this: HTMLDialogElement) {
          this.removeAttribute('open')
        }),
      })
      return mount(QuickAiRequestMenu, {
        props: { screenshotMode: true, screenshots: [screenshot] },
        global: {
          plugins: [desktop.pinia],
          stubs: {
            AppIcon: true,
            ChatImageAttachment: {
              props: ['image', 'removable', 'size'],
              template:
                '<div class="shot" :data-id="image.id" :data-size="size"><button v-if="removable" class="remove-shot" @click="$emit(\'remove\')" /></div>',
            },
          },
        },
      })
    }

    it('previews the screenshot in large size and deletes it only after confirmation', async () => {
      desktop.backend.handle('remove_screenshot', () => undefined)
      const wrapper = mountScreenshotMenu()
      expect(wrapper.find('.shot').attributes('data-id')).toBe('shot-1')
      expect(wrapper.find('.shot').attributes('data-size')).toBe('large')

      await wrapper.find('.remove-shot').trigger('click')
      await flushPromises()
      expect(desktop.backend.callsOf('remove_screenshot')).toHaveLength(0)

      const cancelBtn = document.body.querySelector<HTMLButtonElement>(
        '.confirm-modal-actions button:first-child'
      )!
      cancelBtn.click()
      await flushPromises()
      expect(desktop.backend.callsOf('remove_screenshot')).toHaveLength(0)
      expect(wrapper.find('.shot').exists()).toBe(true)

      await wrapper.find('.remove-shot').trigger('click')
      await flushPromises()
      const confirmBtn = document.body.querySelector<HTMLButtonElement>(
        '.confirm-modal-actions button:last-child'
      )!
      confirmBtn.click()
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
