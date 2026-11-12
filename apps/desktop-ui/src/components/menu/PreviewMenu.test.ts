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

    // Result mode edits the same draft as the split view.
    expect(
      wrapper.findComponent({ name: 'ParallelTextPreview' }).exists()
    ).toBe(false)
    await wrapper.get('textarea').setValue('Edited result\nwith a new line')
    expect(wrapper.findComponent({ name: 'ShortcutList' }).props('text')).toBe(
      'Edited result\nwith a new line'
    )
    const toggle = wrapper.findComponent({ name: 'ResultViewModeToggle' })
    toggle.vm.$emit('update:modelValue', 'split')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('textarea').element.value).toBe(
      'Edited result\nwith a new line'
    )
    await wrapper.get('textarea').setValue('Edited in split')
    toggle.vm.$emit('update:modelValue', 'result')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('textarea').element.value).toBe('Edited in split')
    expect(wrapper.findComponent({ name: 'ShortcutList' }).props('text')).toBe(
      'Edited in split'
    )
  })

  it('configures Escape to follow the navigation stack', () => {
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
    ).toBe('auto')
    expect(wrapper.find('.shortcut-list').attributes('data-esc-mode')).toBe(
      'auto'
    )
  })
})

afterEach(() => {
  config.global.plugins = []
  desktop.dispose()
})
