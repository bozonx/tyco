import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from '../../stores/chat'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import AiTaskMenu from './AiTaskMenu.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const aiTasks = vi.hoisted(() => vi.fn())
const aiCustomPrompt = vi.hoisted(() => vi.fn())
vi.mock('../../composables/useCallAi', () => ({
  useCallAi: () => ({ aiTasks, aiCustomPrompt }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

describe('AiTaskMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
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
        'altText',
        'altAlwaysVisible',
        'altAction',
        'altLabel',
        'altIcon',
        'leftLetterKeys',
        'stopListening',
        'toEditorVisible',
      ],
      setup(props: any) {
        onProps(props)
        return () => null
      },
    },
  })

  it('does not bind chat to Shift+Space and binds the own request to Space/Enter', async () => {
    let shortcutListProps: Record<string, any> = {}

    const wrapper = mount(AiTaskMenu, {
      props: { text: 'Some task text' },
      global: { stubs: stubs((props) => (shortcutListProps = props)) },
    })

    expect(shortcutListProps.altAction).toBeUndefined()
    expect(shortcutListProps.altText).toBeUndefined()

    expect(shortcutListProps.spaceKey.labelKey).toBe('menu.aiCustomPrompt')
    await shortcutListProps.spaceKey.action('Some task text')
    await nextTick()
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('runs an own request on the text and remembers it', async () => {
    const ipcStore = useIpcStore()
    const patchLocalState = vi
      .spyOn(ipcStore, 'patchLocalState')
      .mockResolvedValue({ success: true, result: undefined })
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    vi.spyOn(historyStore, 'saveSourceResult').mockResolvedValue()
    const menuModalsStore = useMenuModalsStore()
    menuModalsStore.nextModal(MenuModals.AI_TASK)
    aiCustomPrompt.mockResolvedValue('Shorter text')
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

    await vi.waitFor(() =>
      expect(menuModalsStore.currentModal).toBe(MenuModals.DIFF)
    )
    expect(aiCustomPrompt).toHaveBeenCalledWith(
      'Make it shorter',
      text,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(patchLocalState).toHaveBeenCalledWith({
      recentAiPrompts: ['Make it shorter'],
    })
  })

  it('saves an own request as a task in a free key', async () => {
    const ipcStore = useIpcStore()
    ipcStore.params.userConfig.aiTasks = [{ name: 'edit', rule: 'Edit it' }]
    const saveUserConfig = vi
      .spyOn(ipcStore, 'saveUserConfig')
      .mockResolvedValue({ success: true, result: undefined })
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

    await vi.waitFor(() => expect(saveUserConfig).toHaveBeenCalled())
    expect(saveUserConfig.mock.calls[0]![0].aiTasks).toEqual([
      { name: 'edit', rule: 'Edit it' },
      { name: 'Make it formal', rule: 'Make it formal' },
    ])
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
              'stopListening',
              'toEditorVisible',
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
      name: 'deepEdit',
    })
  })

  it('keeps the result of a menu closed meanwhile off the screen', async () => {
    const ipcStore = useIpcStore()
    ipcStore.params.userConfig.aiTasks = [{ name: 'edit', rule: 'Edit it' }]
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    const saveResult = vi
      .spyOn(historyStore, 'saveSourceResult')
      .mockResolvedValue()
    const menuModalsStore = useMenuModalsStore()
    menuModalsStore.nextModal(MenuModals.AI_TASK)
    let finish: (text: string) => void = () => {}
    aiTasks.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve
      })
    )
    let shortcutListProps: Record<string, any> = {}

    mount(AiTaskMenu, {
      props: { text: 'Some task text that is long enough to process' },
      global: {
        stubs: {
          TextPreview: true,
          ActionOverlayLayout: {
            template: `<div><slot name="preview" /><slot name="actions" /></div>`,
          },
          ShortcutList: {
            props: ['leftLetterKeys'],
            setup(props: any) {
              shortcutListProps = props
              return () => null
            },
          },
        },
      },
    })

    const running = shortcutListProps.leftLetterKeys[0].action()
    await vi.waitFor(() => expect(aiTasks).toHaveBeenCalled())
    // the main window was closed while the task ran
    menuModalsStore.closeAll()
    finish('Changed text')
    await running

    expect(saveResult).toHaveBeenCalledWith('source-1', 'Changed text')
    expect(menuModalsStore.currentModal).toBe(MenuModals.NONE)
  })
})
