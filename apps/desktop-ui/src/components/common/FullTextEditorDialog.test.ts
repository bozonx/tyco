import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import FullTextEditorDialog from './FullTextEditorDialog.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params?.count !== undefined) return `${key}:${params.count}`
      return key
    },
  }),
}))

describe('FullTextEditorDialog', () => {
  it('renders title, stats, and handles text input', async () => {
    const wrapper = mount(FullTextEditorDialog, {
      props: {
        open: true,
        title: 'Edit file.md',
        modelValue: 'line 1\nline 2',
      },
      global: {
        stubs: {
          BaseDialog: {
            props: ['open'],
            template: '<div v-if="open"><slot /></div>',
          },
          AppIcon: true,
          CopyButton: true,
          Button: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Edit file.md')
    expect(wrapper.text()).toContain('common.linesCount:2')
    expect(wrapper.text()).toContain('common.charsCount:13')

    const textarea = wrapper.get('textarea')
    await textarea.setValue('new content')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['new content'])
  })

  it('renders custom actions slot', () => {
    const wrapper = mount(FullTextEditorDialog, {
      props: {
        open: true,
        title: 'Custom Actions',
        modelValue: 'content',
      },
      slots: {
        actions: '<button class="custom-save">Save</button>',
      },
      global: {
        stubs: {
          BaseDialog: {
            props: ['open'],
            template: '<div v-if="open"><slot /></div>',
          },
          AppIcon: true,
        },
      },
    })

    expect(wrapper.find('.custom-save').exists()).toBe(true)
  })
})
