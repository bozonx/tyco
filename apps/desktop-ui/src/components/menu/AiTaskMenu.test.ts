import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LlmStreamEvent } from '../../lib/llm/llm-client'
import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import AiTaskMenu from './AiTaskMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      key + (params ? `:${JSON.stringify(params)}` : ''),
  }),
}))

const streamMock = vi.fn()
vi.mock('../../stores/llm', () => ({
  useLlmStore: () => ({
    client: { stream: (...args: any[]) => streamMock(...args) },
    actions: {},
  }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

function fakeStream(text: string): AsyncIterable<LlmStreamEvent> {
  return (async function* () {
    yield { type: 'reasoning', text: 'Thinking...' }
    yield { type: 'text', text }
    yield { type: 'finish', finishReason: 'stop', text, responseMessages: [] }
  })()
}

describe('AiTaskMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    streamMock.mockReset()
  })

  const stubs = (onProps: (props: Record<string, any>) => void) => ({
    TextPreview: true,
    ActionOverlayLayout: {
      template: `<div><slot name="preview" /><slot name="actions" /></div>`,
    },
    ShortcutList: {
      props: [
        'text',
        'spaceKey',
        'leftLetterKeys',
        'shortcutsDisabled',
        'isEditorButtonVisible',
      ],
      setup(props: any) {
        onProps(props)
        return () => null
      },
    },
  })

  it('binds the own request to Space/Enter', async () => {
    let shortcutListProps: Record<string, any> = {}

    const wrapper = mount(AiTaskMenu, {
      props: { text: 'Some task text' },
      global: { stubs: stubs((props) => (shortcutListProps = props)) },
    })

    expect(shortcutListProps.spaceKey.labelKey).toBe('menu.aiCustomPrompt')
    await shortcutListProps.spaceKey.action('Some task text')
    await nextTick()
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('runs an own request on the text and remembers it', async () => {
    const desktop = useDesktopStore()
    const patchSessionState = vi
      .spyOn(desktop, 'patchSessionState')
      .mockResolvedValue({
        success: true,
        result: desktop.desktopState.sessionState,
      })
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    const saveSourceResult = vi
      .spyOn(historyStore, 'saveSourceResult')
      .mockResolvedValue()
    streamMock.mockReturnValue(fakeStream('Shorter text'))

    let shortcutListProps: Record<string, any> = {}
    const text = 'Some task text that is long enough to process'

    const wrapper = mount(AiTaskMenu, {
      props: { text },
      global: { stubs: stubs((props) => (shortcutListProps = props)) },
    })
    await shortcutListProps.spaceKey.action(text)
    await nextTick()
    const input = wrapper.find('input')
    await input.setValue('Make it shorter')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(streamMock).toHaveBeenCalled())
    expect(streamMock).toHaveBeenCalledWith(
      'aiTask',
      expect.objectContaining({
        system: expect.stringContaining('Make it shorter'),
        messages: [{ role: 'user', content: text }],
      }),
      expect.any(Object)
    )
    expect(patchSessionState).toHaveBeenCalledWith({
      recentAiPrompts: ['Make it shorter'],
    })
    await vi.waitFor(() =>
      expect(saveSourceResult).toHaveBeenCalledWith('source-1', 'Shorter text')
    )
  })

  it('saves an own request as a task in a free key', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.userConfig.aiTasks = {
      items: [
        {
          id: 'task-1',
          name: 'edit',
          prompt: 'Edit it',
          allowedTools: [],
          outputAction: 'replace',
          maxSteps: 5,
        },
      ],
      slots: { q: 'task-1' },
    }
    const updateUserConfig = vi
      .spyOn(desktop, 'updateUserConfig')
      .mockResolvedValue({
        success: true,
        result: desktop.desktopState.userConfig,
      })
    let shortcutListProps: Record<string, any> = {}

    const wrapper = mount(AiTaskMenu, {
      props: { text: 'Some task text' },
      global: { stubs: stubs((props) => (shortcutListProps = props)) },
    })
    await shortcutListProps.spaceKey.action('Some task text')
    await nextTick()
    const input = wrapper.find('input')
    await input.setValue('Make it formal')
    await input.trigger('keydown', { key: 's', code: 'KeyS', ctrlKey: true })

    await vi.waitFor(() => expect(updateUserConfig).toHaveBeenCalled())
    expect(updateUserConfig.mock.calls[0]![0]).toEqual({
      aiTasks: {
        items: [
          {
            id: 'task-1',
            name: 'edit',
            prompt: 'Edit it',
            allowedTools: [],
            outputAction: 'replace',
            maxSteps: 5,
          },
          {
            id: 'task-2',
            name: 'Make it formal',
            prompt: 'Make it formal',
            allowedTools: [],
            outputAction: 'replace',
            maxSteps: 5,
          },
        ],
        slots: { q: 'task-1', w: 'task-2' },
      },
    })
  })

  it('binds configured aiTasks to leftLetterKeys using item name', () => {
    let shortcutListProps: Record<string, any> = {}

    mount(AiTaskMenu, {
      props: { text: 'Some task text' },
      global: {
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template: `<div><slot name="preview" /><slot name="actions" /></div>`,
          },
          ShortcutList: {
            props: [
              'text',
              'spaceKey',
              'actionsKey',
              'leftLetterKeys',
              'shortcutsDisabled',
              'isEditorButtonVisible',
            ],
            setup(props: any) {
              shortcutListProps = props
              return () => null
            },
          },
        },
      },
    })

    expect(shortcutListProps.leftLetterKeys).toBeDefined()
    expect(shortcutListProps.leftLetterKeys[0]).toMatchObject({
      name: 'Deep edit',
    })
  })

  it('prompts for manual input when text is empty', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.userConfig.aiTasks = {
      items: [
        {
          id: 'task-1',
          name: 'Summarize',
          prompt: 'Summarize it',
          allowedTools: [],
          outputAction: 'replace',
          maxSteps: 5,
        },
      ],
      slots: { q: 'task-1' },
    }
    streamMock.mockReturnValue(fakeStream('Manual summary'))

    let shortcutListProps: Record<string, any> = {}
    const wrapper = mount(AiTaskMenu, {
      props: { text: '' },
      global: { stubs: stubs((props) => (shortcutListProps = props)) },
    })

    // Click on the task
    await shortcutListProps.leftLetterKeys[0].action()
    await nextTick()

    // QueryPanel should be open for manual input
    const input = wrapper.find('input')
    expect(input.exists()).toBe(true)

    // Type text and submit
    await input.setValue('Text to summarize')
    await input.trigger('keydown', { key: 'Enter' })

    await vi.waitFor(() => expect(streamMock).toHaveBeenCalled())
    expect(streamMock).toHaveBeenCalledWith(
      'aiTask',
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Text to summarize' }],
      }),
      expect.any(Object)
    )
  })

  it('runs the task of the main menu item once, by its id', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.userConfig.aiTasks = {
      items: [
        {
          id: 'task-7',
          name: 'edit',
          prompt: 'Edit it',
          allowedTools: [],
          outputAction: 'replace',
          maxSteps: 5,
        },
      ],
      slots: { w: 'task-7' },
    }
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    vi.spyOn(historyStore, 'saveSourceResult').mockResolvedValue()
    const menuModalsStore = useMenuModalsStore()
    const text = 'Some task text that is long enough to process'
    menuModalsStore.nextModal(MenuModals.AI_TASK, { text, taskId: 'task-7' })
    streamMock.mockReturnValue(fakeStream('Changed text'))

    mount(AiTaskMenu, {
      props: menuModalsStore.currentModalParams,
      global: { stubs: stubs(() => {}) },
    })

    await vi.waitFor(() => expect(streamMock).toHaveBeenCalled())
    expect(streamMock).toHaveBeenCalledWith(
      'aiTask',
      expect.objectContaining({
        system: expect.stringContaining('Edit it'),
        messages: [{ role: 'user', content: text }],
      }),
      expect.any(Object)
    )
  })
})
