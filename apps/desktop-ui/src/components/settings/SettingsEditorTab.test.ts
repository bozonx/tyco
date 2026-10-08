import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SettingsEditorTab from './SettingsEditorTab.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('SettingsEditorTab.vue', () => {
  const createConfig = () => ({
    markdown: {
      bullet: '-',
      emphasis: '*',
      strong: '*',
      headingStyle: 'atx',
      incrementListMarker: true,
    },
    markdownClean: {
      bullet: '-',
      codeBlockIndent: 'none',
      blockquoteIndent: 'none',
      keepInlineCode: false,
      linkFormat: 'text',
      keepTaskCheckboxes: true,
    },
  })

  it('renders both Markdown formatting and Markdown cleanup sections', () => {
    const userConfig = createConfig()
    const wrapper = mount(SettingsEditorTab, {
      props: { userConfig },
      global: {
        stubs: {
          SettingsSection: {
            props: ['title', 'description'],
            template:
              '<section class="section-stub" :data-title="title"><slot /></section>',
          },
          FieldRow: {
            props: ['label'],
            template:
              '<div class="field-row-stub" :data-label="label"><slot /></div>',
          },
          FieldSelect: {
            props: ['value', 'options'],
            template: '<select class="field-select-stub" :data-val="value" />',
          },
          FieldCheckbox: {
            props: ['value'],
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
    expect(sections[1].attributes('data-title')).toBe(
      'settings.sectionMarkdownClean'
    )

    // Markdown formatting rows
    expect(
      wrapper.find('[data-label="settings.markdownBullet"]').exists()
    ).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.markdownIncrementListMarker"]')
        .exists()
    ).toBe(true)

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
      wrapper
        .find('[data-label="settings.markdownCleanKeepInlineCode"]')
        .exists()
    ).toBe(true)
    expect(
      wrapper
        .find('[data-label="settings.markdownCleanKeepTaskCheckboxes"]')
        .exists()
    ).toBe(true)
  })

  it('initializes missing markdown and markdownClean configs with defaults', () => {
    const userConfig: Record<string, any> = {}
    mount(SettingsEditorTab, {
      props: { userConfig },
      global: {
        stubs: {
          SettingsSection: true,
          FieldRow: true,
          FieldSelect: true,
          FieldCheckbox: true,
        },
      },
    })

    expect(userConfig.markdown).toBeDefined()
    expect(userConfig.markdown.bullet).toBe('-')
    expect(userConfig.markdownClean).toBeDefined()
    expect(userConfig.markdownClean.bullet).toBe('-')
    expect(userConfig.markdownClean.codeBlockIndent).toBe('none')
  })
})
