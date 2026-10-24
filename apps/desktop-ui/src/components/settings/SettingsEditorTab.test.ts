import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { createTestSettingsContext } from '../../test/settings-context'
import SettingsEditorTab from './SettingsEditorTab.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsEditorTab.vue', () => {
  const createConfig = (): Pick<UserConfig, 'markdown'> => ({
    markdown: {
      format: {
        bullet: '-',
        emphasis: '*',
        strong: '*',
        headingStyle: 'atx',
        isListMarkerIncremented: true,
      },
      strip: {
        bullet: '-',
        codeBlockIndent: 'none',
        blockquoteIndent: 'none',
        hasInlineCode: false,
        linkFormat: 'text',
        imageFormat: 'alt',
        hasThematicBreaks: true,
        hasTaskCheckboxes: true,
      },
    },
  })

  it('renders both Markdown formatting and Markdown cleanup sections', () => {
    const userConfig = createConfig()
    const wrapper = mount(SettingsEditorTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: {
            props: ['title', 'description', 'info'],
            template:
              '<section class="section-stub" :data-title="title" :data-info="info"><slot /></section>',
          },
          FieldRow: {
            props: ['label', 'info'],
            template:
              '<div class="field-row-stub" :data-label="label" :data-info="info"><slot /></div>',
          },
          FieldSelect: {
            props: ['modelValue', 'options'],
            template:
              '<select class="field-select-stub" :data-val="modelValue" />',
          },
          FieldSwitch: {
            props: ['modelValue'],
            template: '<input type="checkbox" class="field-checkbox-stub" />',
          },
        },
      },
    })

    const sections = wrapper.findAll('.section-stub')
    expect(sections).toHaveLength(2)
    expect(sections[0].attributes('data-title')).toBe(
      'settings.sectionMarkdown'
    )
    expect(sections[0].attributes('data-info')).toBe('settings.markdownHint')
    expect(sections[1].attributes('data-title')).toBe(
      'settings.sectionMarkdownClean'
    )
    expect(sections[1].attributes('data-info')).toBe(
      'settings.markdownCleanHint'
    )

    // Markdown formatting rows
    expect(
      wrapper.find('[data-label="settings.markdownBullet"]').exists()
    ).toBe(true)
    const incrementRow = wrapper.find(
      '[data-label="settings.markdownIncrementListMarker"]'
    )
    expect(incrementRow.exists()).toBe(true)
    expect(incrementRow.attributes('data-info')).toBe(
      'settings.markdownIncrementListMarkerInfo'
    )

    // Markdown clean rows
    expect(
      wrapper.find('[data-label="settings.markdownCleanBullet"]').exists()
    ).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.markdownCleanCodeBlockIndent"]')
        .exists()
    ).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.markdownCleanBlockquoteIndent"]')
        .exists()
    ).toBe(true)
    expect(
      wrapper.find('[data-label="settings.markdownCleanLinkFormat"]').exists()
    ).toBe(true)
    expect(
      wrapper.find('[data-label="settings.markdownCleanImageFormat"]').exists()
    ).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.markdownCleanKeepInlineCode"]')
        .exists()
    ).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.markdownCleanKeepHorizontalRules"]')
        .exists()
    ).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.markdownCleanKeepTaskCheckboxes"]')
        .exists()
    ).toBe(true)
  })

  it('uses the normalized markdown defaults', () => {
    const userConfig = structuredClone(DEFAULT_USER_CONFIG)
    mount(SettingsEditorTab, {
      global: {
        provide: createTestSettingsContext(userConfig).provide,
        stubs: {
          SettingsSection: true,
          FieldRow: true,
          FieldSelect: true,
          FieldSwitch: true,
        },
      },
    })

    expect(userConfig.markdown.format.bullet).toBe('-')
    expect(userConfig.markdown.strip.bullet).toBe('-')
    expect(userConfig.markdown.strip.codeBlockIndent).toBe('none')
    expect(userConfig.markdown.strip.hasThematicBreaks).toBe(true)
  })

  it('shows the editor history only in development mode', () => {
    const mountTab = (isInDevelopment: boolean) =>
      mount(SettingsEditorTab, {
        global: {
          provide: createTestSettingsContext({ isInDevelopment }).provide,
          stubs: {
            SettingsSection: true,
            SettingsEditorHistorySection: {
              template: '<div class="editor-history-stub" />',
            },
          },
        },
      })

    expect(mountTab(true).find('.editor-history-stub').exists()).toBe(true)
    expect(mountTab(false).find('.editor-history-stub').exists()).toBe(false)
  })
})
