import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from '../../stores/chat'
import { useMenuModalsStore } from '../../stores/menuModals'
import AiTaskMenu from './AiTaskMenu.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
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
})
