import { config, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PreviewMenu from './PreviewMenu.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}))

describe('PreviewMenu', () => {
  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    config.global.plugins = [pinia]
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
    expect(alert.classes()).toContain('is-warning')
  })

  it('reads translation view mode preference from sessionState', async () => {
    const { useIpcStore } = await import('../../stores/ipc')
    const ipcStore = useIpcStore()
    ipcStore.desktopState.userConfig.translation.viewMode = 'result'

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
})

afterEach(() => {
  config.global.plugins = []
})
