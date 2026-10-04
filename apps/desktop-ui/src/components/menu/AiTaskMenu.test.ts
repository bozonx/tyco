import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
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
vi.mock('../../composables/useCallAi', () => ({
  useCallAi: () => ({ aiTasks }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

describe('AiTaskMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('binds chat action to spaceKey so both Space and Enter navigate to chat', async () => {
    const chatStore = useChatStore()
    const attachSpy = vi.spyOn(chatStore, 'attachToChat').mockResolvedValue()
    const menuModalsStore = useMenuModalsStore()
    const closeAllSpy = vi.spyOn(menuModalsStore, 'closeAll')

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

    expect(shortcutListProps.spaceKey).toBeDefined()
    expect(shortcutListProps.spaceKey.labelKey).toBe('action.askInChat')

    await shortcutListProps.spaceKey.action('Some task text')

    expect(closeAllSpy).toHaveBeenCalled()
    expect(attachSpy).toHaveBeenCalledWith('Some task text')
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
