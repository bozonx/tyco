import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import TranslationLanguageSelect from './TranslationLanguageSelect.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' } }),
}))

describe('TranslationLanguageSelect', () => {
  const mountSelect = (props: {
    provider: 'llm' | 'deepl' | 'google'
    modelValue?: string | null
    placeholder?: string
  }) =>
    mount(TranslationLanguageSelect, {
      props,
      global: { stubs: { Teleport: true } },
    })

  it('keeps the selection visible and finds a less common Qwen language code', async () => {
    const wrapper = mountSelect({ provider: 'llm', modelValue: 'mhr' })
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')
    expect(trigger.text()).toContain('mhr')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)

    // Open dropdown
    await trigger.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    expect(wrapper.findAll('[role="option"]').length).toBeLessThanOrEqual(101)

    // Search for code
    await wrapper.get('input[type="search"]').setValue('mhr')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)

    // Pick language
    await wrapper.get('[role="option"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['mhr']])
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('changes the available codes with the provider and retains unavailable selections visibly', async () => {
    const wrapper = mountSelect({ provider: 'llm', modelValue: 'zzj' })
    await wrapper.setProps({ provider: 'deepl' })
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')
    expect(trigger.text()).toContain('settings.translationLanguageUnavailable')

    await trigger.trigger('click')
    await flushPromises()
    const unavailable = wrapper.get('[role="option"][disabled]')
    expect(unavailable.text()).toContain(
      'settings.translationLanguageUnavailable'
    )

    await wrapper.get('input[type="search"]').setValue('zh-Hant')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
    expect(wrapper.get('[role="option"]').text()).toContain('zh-Hant')

    await wrapper.setProps({ provider: 'google' })
    await wrapper.get('input[type="search"]').setValue('zh-Hant')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)

    await wrapper.get('input[type="search"]').setValue('zh-TW')
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1)
  })

  it('displays the accepted provider code for an old saved regional preference', () => {
    const wrapper = mountSelect({ provider: 'google', modelValue: 'ru-RU' })
    expect(wrapper.get('button[aria-haspopup="listbox"]').text()).toContain(
      '(ru)'
    )
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('supports keyboard opening, navigation, and selection', async () => {
    const wrapper = mountSelect({ provider: 'deepl', modelValue: null })
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')

    // Open via Enter
    await trigger.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)

    // Search and select via Enter key
    await wrapper.get('input[type="search"]').setValue('de')
    const panel = wrapper.get('.translation-language-panel')
    await panel.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toBe('de')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('closes on Escape', async () => {
    const wrapper = mountSelect({ provider: 'deepl', modelValue: 'en' })
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')

    await trigger.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)

    const panel = wrapper.get('.translation-language-panel')
    await panel.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })
})
