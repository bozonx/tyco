import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PreviewMenu from './PreviewMenu.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

describe('PreviewMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('does not display quality alert when translation is clean', () => {
    const wrapper = mount(PreviewMenu, {
      props: {
        text: 'Clean translation',
        sourceText: 'Original text',
        translationMeta: {
          provider: 'llm',
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
    expect(wrapper.findComponent({ name: 'ParallelModeToggle' }).exists()).toBe(
      true
    )
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
    expect(alert.classes()).toContain('is-warning')
  })
})
