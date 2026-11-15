import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuleLibraryMenuKind } from '../../lib/modals/rule-library-menu'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import ContextPreview from '../overlay/ContextPreview.vue'
import RuleLibraryMenu from './RuleLibraryMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const transform = vi.fn()

const kind: RuleLibraryMenuKind = {
  titleKey: 'menu.transformation',
  operationId: 'core.transformation',
  minTextLength: 3,
  pending: { transformation: true },
  getLibrary: (config) => config?.transformations,
  clearStartupItem: () => undefined,
}

describe('RuleLibraryMenu', () => {
  let shortcutListProps: Record<string, any> = {}
  let desktop: TestDesktop

  const mountMenu = (props: Record<string, unknown> = {}) =>
    mount(RuleLibraryMenu, {
      props: { kind, text: 'Initial text', ...props },
      global: {
        stubs: {
          ContextPreview: true,
          ActionOverlayLayout: {
            template: `<div><slot name="preview" /><slot name="actions" /></div>`,
          },
          ShortcutList: {
            props: ['text', 'leftLetterKeys'],
            setup(props: any) {
              shortcutListProps = props
              return () => null
            },
          },
        },
      },
    })

  beforeEach(async () => {
    desktop = await loadFakeDesktop()
    transform.mockReset()
  })

  afterEach(() => desktop.dispose())

  it('renders editable ContextPreview and updates draftText across modal step and actions', async () => {
    const menus = useMenuModalsStore()
    menus.nextModal(MenuModals.TRANSFORMATION, { text: 'Initial text' })
    const wrapper = mountMenu()

    const preview = wrapper.findComponent(ContextPreview)
    expect(preview.exists()).toBe(true)
    expect(preview.props('editable')).toBe(true)
    expect(shortcutListProps.text).toBe('Initial text')

    preview.vm.$emit('update:text', 'Modified text')
    await nextTick()

    expect(shortcutListProps.text).toBe('Modified text')
    expect(menus.currentModalParams).toMatchObject({ text: 'Modified text' })
  })
})
