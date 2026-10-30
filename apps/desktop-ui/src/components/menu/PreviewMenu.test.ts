import { config, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  loadFakeDesktop,
  type TestDesktop,
} from '../../test/install-fake-desktop'
import PreviewMenu from './PreviewMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

let desktop: TestDesktop

describe('PreviewMenu', () => {
  beforeEach(async () => {
    desktop = await loadFakeDesktop()
    config.global.plugins = [desktop.pinia]
    localStorage.clear()
  })

  it('does not display quality alert when translation is clean', () => {
    const wrapper = mount(PreviewMenu, {
      props: {
        text: 'Clean translation',
        sourceText: 'Original text',
        translationMeta: {
          provider: 'llm',
          kind: 'llm',
          model: 'gpt-4o-mini',
          quality: {
            gate: 'on_problems',
            problems: [],
            remainingProblems: [],
            repaired: false,
            repairFailed: false,
          },
        },
      },
      global: {
        stubs: {
          Icon: true,
          ShortcutList: true,
          ActionOverlayLayout: {
            template: `
              <div class="action-overlay-layout">
                <slot name="header-extra" />
                <slot name="preview" />
                <slot name="actions" />
              </div>
            `,
          },
        },
      },
    })

    expect(wrapper.find('.translation-quality-alert').exists()).toBe(false)
    expect(wrapper.text()).toContain('gpt-4o-mini')
    expect(
      wrapper.findComponent({ name: 'ResultViewModeToggle' }).exists()
    ).toBe(true)
    expect(
      wrapper.findComponent({ name: 'ParallelTextPreview' }).exists()
    ).toBe(true)
  })

  it('displays quality alert when quality issues are detected', () => {
    const wrapper = mount(PreviewMenu, {
      props: {
        text: 'Translation with issues',
        translationMeta: {
          provider: 'deepl',
          kind: 'machine',
          quality: {
            gate: 'on_problems',
            problems: [{ code: 'untranslated' }],
            remainingProblems: [],
            repaired: false,
            repairFailed: false,
          },
        },
      },
      global: {
        stubs: {
          Icon: true,
          ShortcutList: true,
          ActionOverlayLayout: {
            template: `
              <div class="action-overlay-layout">
                <slot name="header-extra" />
                <slot name="preview" />
                <slot name="actions" />
              </div>
            `,
          },
        },
      },
    })

    const alert = wrapper.find('.translation-quality-alert')
    expect(alert.exists()).toBe(true)
    expect(alert.classes()).toContain('inline-notice--warning')
  })

  it('reads translation view mode preference from sessionState', async () => {
    desktop.setUserConfig({
      translation: {
        ...desktop.backend.userConfig.translation,
        viewMode: 'result',
      },
    })

    const wrapper = mount(PreviewMenu, {
      props: { text: 'Translation text', sourceText: 'Original text' },
      global: {
        stubs: {
          Icon: true,
          ShortcutList: true,
          ActionOverlayLayout: {
            template: `
              <div class="action-overlay-layout">
                <slot name="header-extra" />
                <slot name="preview" />
                <slot name="actions" />
              </div>
            `,
          },
        },
      },
    })

    // When viewMode is 'result', ParallelTextPreview is not rendered, TextPreview is rendered
    expect(
      wrapper.findComponent({ name: 'ParallelTextPreview' }).exists()
    ).toBe(false)
    expect(wrapper.findComponent({ name: 'TextPreview' }).exists()).toBe(true)
  })

  it('configures escape mode to close the window on Escape', () => {
    const wrapper = mount(PreviewMenu, {
      props: { text: 'Some result' },
      global: {
        stubs: {
          Icon: true,
          ShortcutList: {
            props: ['escMode'],
            template: '<div class="shortcut-list" :data-esc-mode="escMode" />',
          },
          ActionOverlayLayout: {
            props: ['escMode'],
            template: `
              <div class="action-overlay-layout" :data-esc-mode="escMode">
                <slot name="actions" />
              </div>
            `,
          },
        },
      },
    })

    expect(
      wrapper.find('.action-overlay-layout').attributes('data-esc-mode')
    ).toBe('close')
    expect(wrapper.find('.shortcut-list').attributes('data-esc-mode')).toBe(
      'close'
    )
  })
})

afterEach(() => {
  config.global.plugins = []
  desktop.dispose()
})
