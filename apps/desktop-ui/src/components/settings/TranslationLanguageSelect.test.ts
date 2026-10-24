import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import TranslationLanguageSelect from './TranslationLanguageSelect.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' } }),
}))

describe('TranslationLanguageSelect', () => {
  it('finds a rare registry code without rendering thousands of options', async () => {
    const wrapper = mount(TranslationLanguageSelect, {
      props: { provider: 'llm', modelValue: 'zzj' },
    })
    expect(wrapper.findAll('option').length).toBeLessThanOrEqual(101)
    expect(
      (wrapper.get('select').element as HTMLSelectElement).selectedOptions[0]
        ?.textContent
    ).toContain('zzj')
    await wrapper.get('input').setValue('zzj')
    expect(wrapper.findAll('option')).toHaveLength(1)
    await wrapper.get('select').setValue('0')
    expect(wrapper.emitted('update:modelValue')).toEqual([['zzj']])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('changes the available codes with the provider and retains unavailable selections visibly', async () => {
    const wrapper = mount(TranslationLanguageSelect, {
      props: { provider: 'llm', modelValue: 'zzj' },
    })
    await wrapper.setProps({ provider: 'deepl' })
    const selected = (wrapper.get('select').element as HTMLSelectElement)
      .selectedOptions[0]!
    expect(selected.disabled).toBe(true)
    expect(selected.textContent).toContain(
      'settings.mainActionGroups.unavailable'
    )
    await wrapper.get('input').setValue('zh-Hant')
    expect(wrapper.findAll('option')).toHaveLength(1)
    expect(wrapper.get('option').text()).toContain('zh-Hant')
    await wrapper.setProps({ provider: 'google' })
    await wrapper.get('input').setValue('zh-Hant')
    expect(wrapper.findAll('option')).toHaveLength(0)
    await wrapper.get('input').setValue('zh-TW')
    expect(wrapper.findAll('option')).toHaveLength(1)
  })

  it('displays the accepted provider code for an old saved regional preference', () => {
    const wrapper = mount(TranslationLanguageSelect, {
      props: { provider: 'google', modelValue: 'ru-RU' },
    })
    expect(
      (wrapper.get('select').element as HTMLSelectElement).selectedOptions[0]
        ?.textContent
    ).toContain('(ru)')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
