import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useHistoryStore } from '../../stores/history'
import { useDesktopStore } from '../../stores/desktop'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import AiTaskMenu from './AiTaskMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const transform = vi.hoisted(() => vi.fn())
vi.mock('../../stores/invocations', () => ({
  useInvocationsStore: () => ({ call: transform }),
}))

const output = (content: string) => ({ ok: true, content })

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
        'shortcutsDisabled',
        'isEditorButtonVisible',
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
    const desktop = useDesktopStore()
    const patchSessionState = vi
      .spyOn(desktop, 'patchSessionState')
      .mockResolvedValue({
        success: true,
        result: desktop.desktopState.sessionState,
      })
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    vi.spyOn(historyStore, 'saveSourceResult').mockResolvedValue()
    const menuModalsStore = useMenuModalsStore()
    menuModalsStore.nextModal(MenuModals.AI_TASK)
    transform.mockResolvedValue(output('Shorter text'))
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
    expect(transform).toHaveBeenCalledWith(
      'core.aiTask',
      text,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        toolConfig: { prompt: 'Make it shorter' },
      })
    )
    expect(patchSessionState).toHaveBeenCalledWith({
      recentAiPrompts: ['Make it shorter'],
    })
  })

  it('saves an own request as a task in a free key', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.userConfig.aiTasks = {
      items: [{ id: 'task-1', name: 'edit', rule: 'Edit it' }],
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
          { id: 'task-1', name: 'edit', rule: 'Edit it' },
          { id: 'task-2', name: 'Make it formal', rule: 'Make it formal' },
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

  it('keeps the result of a menu closed meanwhile off the screen', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.userConfig.aiTasks = {
      items: [{ id: 'task-1', name: 'edit', rule: 'Edit it' }],
      slots: { q: 'task-1' },
    }
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    const saveResult = vi
      .spyOn(historyStore, 'saveSourceResult')
      .mockResolvedValue()
    const menuModalsStore = useMenuModalsStore()
    menuModalsStore.nextModal(MenuModals.AI_TASK)
    let finish: (text: string) => void = () => {}
    transform.mockReturnValue(
      new Promise((resolve) => {
        finish = (text) => resolve(output(text))
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
    await vi.waitFor(() => expect(transform).toHaveBeenCalled())
    // the main window was closed while the task ran
    menuModalsStore.closeAll()
    finish('Changed text')
    await running

    expect(saveResult).toHaveBeenCalledWith('source-1', 'Changed text')
    expect(menuModalsStore.currentModal).toBe(MenuModals.NONE)
  })

  it('runs the task of the main menu item once, by its id', async () => {
    const desktop = useDesktopStore()
    desktop.desktopState.userConfig.aiTasks = {
      items: [{ id: 'task-7', name: 'edit', rule: 'Edit it' }],
      slots: { w: 'task-7' },
    }
    const historyStore = useHistoryStore()
    vi.spyOn(historyStore, 'saveSource').mockResolvedValue('source-1')
    vi.spyOn(historyStore, 'saveSourceResult').mockResolvedValue()
    const menuModalsStore = useMenuModalsStore()
    const text = 'Some task text that is long enough to process'
    menuModalsStore.nextModal(MenuModals.AI_TASK, { text, taskId: 'task-7' })
    transform.mockResolvedValue(output('Changed text'))

    mount(AiTaskMenu, {
      props: menuModalsStore.currentModalParams,
      global: { stubs: stubs(() => {}) },
    })

    await vi.waitFor(() =>
      expect(menuModalsStore.currentModal).toBe(MenuModals.DIFF)
    )
    expect(transform).toHaveBeenCalledWith(
      'core.aiTask',
      text,
      expect.objectContaining({ toolConfig: { prompt: 'Edit it' } })
    )
    // back on the step, the menu waits for a choice
    menuModalsStore.back()
    expect(menuModalsStore.currentModalParams).toHaveProperty(
      'taskId',
      undefined
    )
  })
})
