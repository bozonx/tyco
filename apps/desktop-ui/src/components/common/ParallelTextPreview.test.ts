import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ParallelTextPreview from './ParallelTextPreview.vue'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('ParallelTextPreview', () => {
  it('renders left and right text in two columns', () => {
    const wrapper = mount(ParallelTextPreview, {
      props: { leftText: 'Original text', rightText: 'Translated text' },
    })

    expect(wrapper.text()).toContain('Original text')
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      'Translated text'
    )
  })

  it('emits update:rightText on textarea input', async () => {
    const wrapper = mount(ParallelTextPreview, {
      props: {
        leftText: 'Original text',
        rightText: 'Translated text',
        editable: true,
      },
    })

    const textarea = wrapper.find('textarea')
    await textarea.setValue('Modified translation')
    expect(wrapper.emitted('update:rightText')).toHaveLength(1)
    expect(wrapper.emitted('update:rightText')![0]).toEqual([
      'Modified translation',
    ])
  })

  it('renders read-only view when editable is false', () => {
    const wrapper = mount(ParallelTextPreview, {
      props: {
        leftText: 'Original text',
        rightText: 'Translated text',
        editable: false,
      },
    })

    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).toContain('Translated text')
  })
})
