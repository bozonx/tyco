import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
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
    desktop.backend.handle('copy_text', () => undefined)
    desktop.backend.handle('add_editor_history_item', () => 'history-1')
    desktop.backend.handle('update_editor_history_item_session', () => undefined)

    desktop.setUserConfig({
      llm: {
        tasks: {
          quickRequest: { modelId: 'gpt-4' },
        },
        models: [
          { id: 'gpt-4', name: 'GPT 4', canUseTools: true },
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
            props: ['icon', 'title'],
            template: '<button class="icon-btn" :title="title" @click="$attrs.onClick"><slot /></button>',
          },
          KeyboardKey: { template: '<kbd class="kbd"><slot /></kbd>' },
          AudioWaveform: true,
          LiveTranscript: true,
          ReplyBlock: {
            props: ['block'],
            template: '<div class="reply-block"><span class="reply-text">{{ block.text }}</span></div>',
          },
        },
      },
    })

  it('renders preview with source text', () => {
    const wrapper = mountMenu({ text: 'Hello text to transform' })
    expect(wrapper.text()).toContain('Hello text to transform')
  })

  it('renders profile selector in header extra', () => {
    const wrapper = mountMenu()
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
  })

  it('shows error banner when model is not configured', async () => {
    desktop.setUserConfig({
      llm: {
        tasks: {
          quickRequest: { modelId: '' },
        },
        models: [],
      },
    })

    const wrapper = mountMenu()
    const input = wrapper.find('.query-panel-input')
    await input.setValue('Explain this')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.find('.quick-error-banner').exists()).toBe(true)
    expect(wrapper.find('.quick-error-text').text()).toBe('settings.errors.noModelConfigured')
  })

  it('shows error banner when model does not support tools', async () => {
    desktop.setUserConfig({
      llm: {
        tasks: {
          quickRequest: { modelId: 'simple-model' },
        },
        models: [
          { id: 'simple-model', name: 'Simple', canUseTools: false },
        ],
      },
    })

    const wrapper = mountMenu()
    const input = wrapper.find('.query-panel-input')
    await input.setValue('Explain this')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(wrapper.find('.quick-error-banner').exists()).toBe(true)
    expect(wrapper.find('.quick-error-text').text()).toBe('settings.errors.toolsUnsupported')
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
})
